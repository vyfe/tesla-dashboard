"""生成一份「像真的」的 TeslaMate 历史数据，用于本地开发和界面验证。

    DATABASE_URL=postgresql://... python3 sql/seed.py

数据是合成的：一辆 Model 3 LR，约 18 个月、900 次行程、160 次充电，
电池容量从 75.6 kWh 缓慢衰减到 ~71 kWh，足以让看板上的每条曲线都有形状。
"""

from __future__ import annotations

import math
import os
import random
from datetime import date, datetime, timedelta, timezone

import psycopg

DSN = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:55432/teslamate"
)
RATED_KWH_PER_KM = 0.143  # 标称能耗，用来由容量反推满电续航
NOMINAL_KWH = 75.6
START = date(2025, 5, 1)
TODAY = date(2026, 11, 13)

rng = random.Random(20261113)
TZ_OFFSET = 8  # 生成的是北京时间，入库统一转成 UTC（与 TeslaMate 一致）


def to_utc(moment: datetime) -> datetime:
    return moment - timedelta(hours=TZ_OFFSET)


def seasonal_temp(day: date) -> float:
    """北京气候的粗糙近似：1 月 ~-3℃，7 月 ~28℃。"""
    phase = (day.timetuple().tm_yday - 15) / 365 * 2 * math.pi
    return round(15.5 - 13 * math.cos(phase) + rng.uniform(-2.5, 2.5), 1)


def capacity_at(progress: float) -> float:
    """18 个月衰减 ~6%，带一点测量噪声。"""
    base = NOMINAL_KWH * (1 - 0.062 * progress)
    return base + rng.uniform(-0.25, 0.25)


def consumption(temp: float, speed_avg: float) -> float:
    kwh_per_km = 0.129
    if temp < 10:
        kwh_per_km += (10 - temp) * 0.0022
    if speed_avg > 70:
        kwh_per_km += (speed_avg - 70) * 0.00045
    return kwh_per_km * rng.uniform(0.94, 1.06)


def main() -> None:
    conn = psycopg.connect(DSN)
    cur = conn.cursor()
    cur.execute(
        "TRUNCATE positions, drives, charging_processes, states, cars, addresses, geofences "
        "RESTART IDENTITY CASCADE"
    )

    cur.execute(
        """
        INSERT INTO cars (eid, vid, vin, name, model, efficiency, trim_badging,
                          marketing_name, exterior_color, wheel_type, display_priority)
        VALUES (1, 1, 'LRW3E7EA9PC000001', '大白', '3', %s, 'LR', 'Model 3', 'PearlWhite', 'Sport', 0)
        RETURNING id
        """,
        (RATED_KWH_PER_KM,),
    )
    car_id = cur.fetchone()[0]

    places = {
        "home": ("家", 39.9962, 116.4808, 80),
        "work": ("望京 SOHO", 39.9967, 116.4810, 120),
        "airport": ("首都机场 T3", 40.0525, 116.6103, 300),
        "sanlitun": ("三里屯太古里", 39.9367, 116.4551, 150),
        "guomao": ("国贸 CBD", 39.9087, 116.4602, 150),
    }
    address_ids: dict[str, int] = {}
    for key, (name, lat, lon, _radius) in places.items():
        cur.execute(
            """
            INSERT INTO addresses (display_name, name, city, state, country, latitude, longitude)
            VALUES (%s, %s, 'Beijing', 'Beijing', 'China', %s, %s) RETURNING id
            """,
            (f"{name}, 朝阳区, 北京市, 中国", name, lat, lon),
        )
        address_ids[key] = cur.fetchone()[0]

    geofences = {"home": None, "work": None}
    for key in geofences:
        name, lat, lon, radius = places[key]
        cur.execute(
            "INSERT INTO geofences (name, latitude, longitude, radius) VALUES (%s, %s, %s, %s) RETURNING id",
            (name, lat, lon, radius),
        )
        geofences[key] = cur.fetchone()[0]

    routes = {
        ("home", "work"): (17.6, 26, 55),
        ("work", "home"): (18.4, 24, 50),
        ("home", "airport"): (28.9, 50, 110),
        ("airport", "home"): (27.2, 43, 110),
        ("home", "sanlitun"): (8.6, 22, 45),
        ("sanlitun", "home"): (8.9, 21, 40),
        ("work", "guomao"): (14.2, 30, 70),
        ("guomao", "work"): (14.6, 28, 65),
        ("home", "guomao"): (13.1, 28, 60),
        ("guomao", "home"): (13.4, 27, 60),
    }

    total_days = (TODAY - START).days
    soc = 82.0
    odometer = 18240.0
    drives: list[tuple] = []
    positions: list[tuple] = []
    charges: list[tuple] = []

    def add_trip(day: date, hour: int, minute: int, origin: str, dest: str) -> None:
        nonlocal soc, odometer
        if soc < 12:
            return
        distance, base_speed, top_speed = routes[(origin, dest)]
        distance = round(distance * rng.uniform(0.92, 1.12), 1)
        temp = seasonal_temp(day)
        duration = max(6, int(distance / base_speed * 60 * rng.uniform(1.0, 1.35)))
        start = datetime.combine(day, datetime.min.time()) + timedelta(
            hours=hour, minutes=minute + int(rng.gauss(0, 4)), seconds=rng.randrange(60)
        )
        end = start + timedelta(minutes=duration)

        capacity = capacity_at((day - START).days / total_days)
        rated_full = capacity / RATED_KWH_PER_KM
        kwh = distance * consumption(temp, base_speed * 1.1)
        drop = kwh / capacity * 100
        start_soc = soc
        soc = max(6.0, soc - drop)
        start_km, end_km = odometer, odometer + distance
        odometer = end_km
        start_utc, end_utc = to_utc(start), to_utc(end)

        drives.append(
            (
                car_id, start_utc, end_utc, start_km, end_km, distance, duration,
                temp, round(20 + rng.uniform(-3, 2), 1),
                int(top_speed * rng.uniform(0.85, 1.15)),
                int(distance * consumption(temp, base_speed) ),
                -12 if rng.random() < 0.3 else None,
                round(rated_full * start_soc / 100, 2),
                round(rated_full * soc / 100, 2),
                round(rated_full * start_soc / 100 * 0.96, 2),
                round(rated_full * soc / 100 * 0.96, 2),
                int(rng.uniform(0, 40)), int(rng.uniform(0, 40)),
                address_ids[origin], address_ids[dest],
                geofences.get(origin), geofences.get(dest),
            )
        )

        # 行程轨迹：每 45 秒一个点
        steps = max(int(duration * 60 / 45), 3)
        for index in range(steps):
            ratio = index / (steps - 1)
            t = start + timedelta(seconds=index * 45)
            speed = (
                top_speed * min(1.0, ratio * 6) if ratio < 0.15
                else top_speed * max(0.0, (1 - ratio) * 5) if ratio > 0.85
                else base_speed * rng.uniform(0.75, 1.35)
            )
            speed = max(0, int(speed))
            level = start_soc + (soc - start_soc) * ratio
            positions.append(
                (
                    car_id, to_utc(t), speed,
                    round(speed * consumption(temp, speed) + rng.uniform(0.4, 2.2), 1),
                    round(odometer - distance + distance * ratio, 2),
                    round(rated_full * level / 100, 2),
                    int(level),
                    temp,
                )
            )

    for offset in range(total_days + 1):
        day = START + timedelta(days=offset)
        progress = offset / total_days
        weekday = day.weekday() < 5

        if weekday:
            add_trip(day, 8, 10, "home", "work")
            if rng.random() < 0.18:
                add_trip(day, 12, 30, "work", "guomao")
                add_trip(day, 14, 10, "guomao", "work")
            add_trip(day, 18, 35, "work", "home")
        else:
            if rng.random() < 0.72:
                target = rng.choice(["sanlitun", "airport", "guomao"])
                add_trip(day, rng.randint(9, 15), rng.randint(0, 50), "home", target)
                add_trip(day, rng.randint(16, 21), rng.randint(0, 50), target, "home")

        if soc < rng.uniform(28, 42):
            capacity = capacity_at(progress)
            rated_full = capacity / RATED_KWH_PER_KM
            target_soc = rng.choice([80, 85, 90, 100]) if rng.random() < 0.9 else 100
            if target_soc <= soc:
                target_soc = min(100, soc + 25)
            if rng.random() < 0.12:  # 偶尔直流快充
                power = rng.uniform(55, 118)
                is_fast = True
            else:
                power = rng.uniform(6.8, 7.4)
                is_fast = False
            start_soc = soc
            kwh = capacity * (target_soc - start_soc) / 100 * rng.uniform(0.995, 1.02)
            duration = max(8, int(kwh / power * 60))
            start = datetime.combine(day, datetime.min.time()) + timedelta(
                hours=rng.randint(20, 23), minutes=rng.randint(0, 55)
            )
            end = start + timedelta(minutes=duration)
            charges.append(
                (
                    car_id, to_utc(start), to_utc(end), round(kwh, 2), round(kwh * 1.08, 2),
                    start_soc, target_soc, duration,
                    round(rated_full * start_soc / 100, 2),
                    round(rated_full * target_soc / 100, 2),
                    seasonal_temp(day),
                    round(kwh * (1.9 if is_fast else 0.48), 2),
                    address_ids["home"],
                )
            )
            soc = target_soc

    cur.executemany(
        """
        INSERT INTO drives (car_id, start_date, end_date, start_km, end_km, distance, duration_min,
                            outside_temp_avg, inside_temp_avg, speed_max, power_max, power_min,
                            start_rated_range_km, end_rated_range_km,
                            start_ideal_range_km, end_ideal_range_km,
                            ascent, descent, start_address_id, end_address_id,
                            start_geofence_id, end_geofence_id)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        drives,
    )

    cur.executemany(
        """
        INSERT INTO positions (car_id, date, speed, power, odometer,
                               rated_battery_range_km, battery_level, outside_temp)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        positions,
    )

    cur.executemany(
        """
        INSERT INTO charging_processes (car_id, start_date, end_date, charge_energy_added,
                                        charge_energy_used, start_battery_level, end_battery_level,
                                        duration_min, start_rated_range_km, end_rated_range_km,
                                        outside_temp_avg, cost, address_id)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        charges,
    )

    # positions 与 drives 的关联：按时间落在行程区间内回填 drive_id
    cur.execute(
        """
        UPDATE positions p
        SET drive_id = d.id
        FROM drives d
        WHERE p.car_id = d.car_id
          AND p.date BETWEEN d.start_date AND d.end_date
          AND p.drive_id IS NULL
        """
    )

    conn.commit()
    print(
        f"✓ car={car_id}  drives={len(drives)}  positions={len(positions)}  charges={len(charges)}"
    )
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
