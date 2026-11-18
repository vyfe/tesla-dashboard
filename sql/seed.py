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


def bezier(p0: tuple[float, float], p1: tuple[float, float], p2: tuple[float, float], t: float):
    """二次贝塞尔插值，用来把起终点连成一条带弧度的路线。"""
    u = 1 - t
    return (
        u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
        u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    )


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """两点球面距离（公里）。"""
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    d_lat, d_lon = lat2 - lat1, lon2 - lon1
    h = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lon / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def route_shape(origin: tuple[float, float], dest: tuple[float, float], target_km: float) -> dict:
    """按目标里程反推路线形状。

    城市里实际开过的路比两点直线长 10%~35%，所以这里让贝塞尔主弧偏离直线，
    再二分求出控制点的偏移量，使路径长度贴近目标里程——这样地图上量出来的
    长度和行程里程才对得上。正弦蜿蜒只负责加一点路面起伏。
    """
    d_lat = dest[0] - origin[0]
    d_lon = dest[1] - origin[1]
    span = math.hypot(d_lat, d_lon) or 1e-6
    normal = (-d_lat / span, d_lon / span)  # 垂直于起终点连线的方向
    mid_lat = (origin[0] + dest[0]) / 2
    mid_lon = (origin[1] + dest[1]) / 2
    sign = rng.choice((-1.0, 1.0))
    cycles = rng.uniform(2.5, 4.5)
    phase = rng.uniform(0, 2 * math.pi)
    amplitude = rng.uniform(0.0006, 0.0014)  # 路面起伏，60~150 米

    def make(offset: float) -> dict:
        return {
            "control": (mid_lat + normal[0] * offset * sign, mid_lon + normal[1] * offset * sign),
            "normal": normal,
            "amplitude": amplitude,
            "cycles": cycles,
            "phase": phase,
        }

    # 弧长随控制点偏移单调增长，二分求偏移量
    low, high = 0.0, max(span, 0.01)
    for _ in range(12):
        if path_length_km(origin, dest, make(high)) >= target_km:
            break
        high *= 2
    for _ in range(28):
        mid = (low + high) / 2
        if path_length_km(origin, dest, make(mid)) < target_km:
            low = mid
        else:
            high = mid
    return make((low + high) / 2)


def path_length_km(
    origin: tuple[float, float], dest: tuple[float, float], shape: dict, samples: int = 120
) -> float:
    """按给定形状采样一遍，算出路径实际长度。"""
    total = 0.0
    prev = route_point(origin, dest, shape, 0.0)
    for index in range(1, samples):
        cur = route_point(origin, dest, shape, index / (samples - 1))
        total += haversine_km(prev, cur)
        prev = cur
    return total


def route_point(
    origin: tuple[float, float],
    dest: tuple[float, float],
    shape: dict,
    ratio: float,
) -> tuple[float, float]:
    """贝塞尔主弧 + 沿线正弦蜿蜒，模拟跟着道路走的形状。"""
    lat, lon = bezier(origin, shape["control"], dest, ratio)
    offset = shape["amplitude"] * math.sin(2 * math.pi * shape["cycles"] * ratio + shape["phase"])
    lat += shape["normal"][0] * offset
    lon += shape["normal"][1] * offset
    return (lat, lon)


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


def build_states(car_id: int, drives: list[tuple], charges: list[tuple]) -> list[tuple]:
    """按行程/充电区间反推车辆状态：有活动 = online，其余 = asleep。

    真实 TeslaMate 的 states 由车辆轮询产生；这里只需要时间段形状，
    让本地的时间线有东西可画。
    """
    busy = [(row[1] + timedelta(hours=TZ_OFFSET), row[2] + timedelta(hours=TZ_OFFSET)) for row in drives]
    busy += [(row[1] + timedelta(hours=TZ_OFFSET), row[2] + timedelta(hours=TZ_OFFSET)) for row in charges]
    busy.sort()

    out: list[tuple] = []
    day = datetime.combine(START, datetime.min.time())
    last = datetime.combine(TODAY, datetime.min.time()) + timedelta(days=1)
    now = datetime.now().replace(microsecond=0)
    while day < last:
        next_day = day + timedelta(days=1)
        limit = min(next_day, now) if day.date() == TODAY else next_day
        if limit > day:
            today = [(max(start, day), min(end, limit)) for start, end in busy if end > day and start < limit]
            merged: list[tuple[datetime, datetime]] = []
            for start, end in today:
                if merged and start <= merged[-1][1] + timedelta(minutes=10):
                    merged[-1] = (merged[-1][0], max(merged[-1][1], end))
                else:
                    merged.append((start, end))
            cursor = day
            for start, end in merged:
                if start > cursor:
                    out.append((car_id, to_utc(cursor), to_utc(start), "asleep"))
                out.append((car_id, to_utc(start), to_utc(end), "online"))
                cursor = end
            if cursor < limit:
                out.append((car_id, to_utc(cursor), to_utc(limit), "asleep"))
        day = next_day
    return out


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

    # 坐标按真实地理位置摆放：两点的直线距离要和下面 routes 里的行程距离自洽，
    # 否则地图上会出现「显示 17km、轨迹却只有 100 米」这种穿帮。
    places = {
        "home": ("家", 39.9962, 116.4808, 80),
        "work": ("中关村软件园", 39.9837, 116.3160, 120),
        "airport": ("通州环球影城", 39.7977, 116.6770, 300),
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

    # 收藏点定价：家按每度电 0.6 元，公司按每分钟 0.05 元 + 5 元服务费
    geofence_pricing = {
        "home": (0.6, None, "per_kwh"),
        "work": (0.05, 5.0, "per_minute"),
    }
    geofences = {"home": None, "work": None}
    for key in geofences:
        name, lat, lon, radius = places[key]
        cost_per_unit, session_fee, billing_type = geofence_pricing[key]
        cur.execute(
            """
            INSERT INTO geofences (name, latitude, longitude, radius,
                                   cost_per_unit, session_fee, billing_type)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (name, lat, lon, radius, cost_per_unit, session_fee, billing_type),
        )
        geofences[key] = cur.fetchone()[0]

    # 里程按「两点的直线距离 × 城市路网系数」给，和上面的坐标自洽。
    routes = {
        ("home", "work"): (17.6, 26, 55),
        ("work", "home"): (18.4, 24, 50),
        ("home", "airport"): (28.9, 50, 110),
        ("airport", "home"): (27.2, 43, 110),
        ("home", "sanlitun"): (8.6, 22, 45),
        ("sanlitun", "home"): (8.9, 21, 40),
        ("work", "guomao"): (16.5, 30, 70),
        ("guomao", "work"): (16.9, 28, 65),
        ("home", "guomao"): (13.1, 28, 60),
        ("guomao", "home"): (13.4, 27, 60),
    }

    total_days = (TODAY - START).days
    soc = 82.0
    odometer = 18240.0
    drives: list[tuple] = []
    positions: list[tuple] = []
    charges: list[tuple] = []
    states: list[tuple] = []

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
        origin_coord = (places[origin][1], places[origin][2])
        dest_coord = (places[dest][1], places[dest][2])
        shape = route_shape(origin_coord, dest_coord, distance)
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
            lat, lon = route_point(origin_coord, dest_coord, shape, ratio)
            # GPS 抖动，约 ±5 米（相对路线尺度足够小，不会把轨迹画成锯齿）
            lat += rng.gauss(0, 0.00005)
            lon += rng.gauss(0, 0.00005)
            positions.append(
                (
                    car_id, to_utc(t), speed,
                    round(speed * consumption(temp, speed) + rng.uniform(0.4, 2.2), 1),
                    round(odometer - distance + distance * ratio, 2),
                    round(rated_full * level / 100, 2),
                    int(level),
                    temp,
                    round(lat, 6),
                    round(lon, 6),
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
            # 家里的充电按「家」收藏点定价：每度电 0.6 元（取电量口径）
            used = round(kwh * 1.08, 2)
            home_cost = round(0.6 * max(used, round(kwh, 2)), 2)
            charges.append(
                (
                    car_id, to_utc(start), to_utc(end), round(kwh, 2), used,
                    start_soc, target_soc, duration,
                    round(rated_full * start_soc / 100, 2),
                    round(rated_full * target_soc / 100, 2),
                    seasonal_temp(day),
                    home_cost,
                    address_ids["home"],
                    geofences["home"],
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
                               rated_battery_range_km, battery_level, outside_temp,
                               latitude, longitude)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        positions,
    )

    cur.executemany(
        """
        INSERT INTO charging_processes (car_id, start_date, end_date, charge_energy_added,
                                        charge_energy_used, start_battery_level, end_battery_level,
                                        duration_min, start_rated_range_km, end_rated_range_km,
                                        outside_temp_avg, cost, address_id, geofence_id)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        charges,
    )

    states = build_states(car_id, drives, charges)
    cur.executemany(
        """
        INSERT INTO states (car_id, start_date, end_date, state)
        VALUES (%s,%s,%s,%s)
        """,
        states,
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
        f"✓ car={car_id}  drives={len(drives)}  positions={len(positions)}  "
        f"charges={len(charges)}  states={len(states)}"
    )
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
