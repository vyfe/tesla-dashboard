"""所有 SQL 都集中在这里，方便你按自己的 TeslaMate 版本微调。"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Any

from psycopg import errors as pg_errors

from . import analytics, db

DRIVE_COLUMNS = """
    d.id, d.start_date, d.end_date, d.distance, d.duration_min,
    d.start_km, d.end_km, d.speed_max, d.power_max, d.power_min,
    d.ascent, d.descent, d.outside_temp_avg, d.inside_temp_avg,
    d.start_rated_range_km, d.end_rated_range_km,
    sa.display_name AS start_address, ea.display_name AS end_address,
    sg.name AS start_geofence, eg.name AS end_geofence
"""

DRIVE_JOINS = """
    FROM drives d
    LEFT JOIN addresses sa ON sa.id = d.start_address_id
    LEFT JOIN addresses ea ON ea.id = d.end_address_id
    LEFT JOIN geofences sg ON sg.id = d.start_geofence_id
    LEFT JOIN geofences eg ON eg.id = d.end_geofence_id
"""


# ------------------------------------------------------------------ 车辆


def list_cars() -> list[dict]:
    return db.query(
        """
        SELECT id, name, model, trim_badging, marketing_name, vin, efficiency
        FROM cars
        ORDER BY display_priority NULLS LAST, id
        """
    )


def get_car(car_id: int) -> dict | None:
    return db.one(
        """
        SELECT id, name, model, trim_badging, marketing_name, vin, efficiency
        FROM cars WHERE id = %(car)s
        """,
        {"car": car_id},
    )


def data_range(car_id: int) -> dict:
    return db.one(
        """
        SELECT MIN(start_date) AS first_drive, MAX(start_date) AS last_drive
        FROM drives WHERE car_id = %(car)s
        """,
        {"car": car_id},
    ) or {}


def latest_position(car_id: int) -> dict | None:
    """车辆最后一次上报的状态。TeslaMate 通常几十秒到几分钟一条。"""
    return db.one(
        """
        SELECT date, battery_level, usable_battery_level,
               rated_battery_range_km, odometer
        FROM positions
        WHERE car_id = %(car)s
        ORDER BY date DESC
        LIMIT 1
        """,
        {"car": car_id},
    )


def active_charge(car_id: int) -> dict | None:
    """未结束的充电进程 = 正在充电。"""
    return db.one(
        """
        SELECT 1 AS active
        FROM charging_processes
        WHERE car_id = %(car)s AND end_date IS NULL
        LIMIT 1
        """,
        {"car": car_id},
    )


# ------------------------------------------------------------------ 行程


def drives(
    car_id: int,
    *,
    limit: int,
    offset: int,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict]:
    clauses = ["d.car_id = %(car)s", "d.distance IS NOT NULL"]
    params: dict[str, Any] = {"car": car_id, "limit": limit, "offset": offset}
    if date_from:
        clauses.append("d.start_date >= %(from)s")
        params["from"] = datetime.combine(date_from, datetime.min.time())
    if date_to:
        clauses.append("d.start_date < %(to)s")
        params["to"] = datetime.combine(date_to + timedelta(days=1), datetime.min.time())
    where = " AND ".join(clauses)
    return db.query(
        f"""
        SELECT {DRIVE_COLUMNS}
        {DRIVE_JOINS}
        WHERE {where}
        ORDER BY d.start_date DESC
        LIMIT %(limit)s OFFSET %(offset)s
        """,
        params,
    )


def drives_count(
    car_id: int, *, date_from: date | None = None, date_to: date | None = None
) -> int:
    clauses = ["car_id = %(car)s", "distance IS NOT NULL"]
    params: dict[str, Any] = {"car": car_id}
    if date_from:
        clauses.append("start_date >= %(from)s")
        params["from"] = datetime.combine(date_from, datetime.min.time())
    if date_to:
        clauses.append("start_date < %(to)s")
        params["to"] = datetime.combine(date_to + timedelta(days=1), datetime.min.time())
    row = db.one(
        f"SELECT COUNT(*) AS n FROM drives WHERE {' AND '.join(clauses)}", params
    )
    return int(row["n"]) if row else 0


def drive(car_id: int, drive_id: int) -> dict | None:
    return db.one(
        f"""
        SELECT {DRIVE_COLUMNS}
        {DRIVE_JOINS}
        WHERE d.car_id = %(car)s AND d.id = %(id)s
        """,
        {"car": car_id, "id": drive_id},
    )


def drive_positions(drive_id: int, *, max_points: int = 400) -> list[dict]:
    rows = db.query(
        """
        SELECT date, speed, power, battery_level, elevation, odometer, inside_temp, outside_temp,
               latitude, longitude
        FROM positions
        WHERE drive_id = %(id)s
        ORDER BY date
        """,
        {"id": drive_id},
    )
    return downsample(rows, max_points)


def downsample(rows: list[dict], max_points: int) -> list[dict]:
    if len(rows) <= max_points:
        return rows
    step = len(rows) / max_points
    return [rows[min(int(i * step), len(rows) - 1)] for i in range(max_points)]


# ------------------------------------------------------------------ 充电


def charging_sessions(car_id: int) -> list[dict]:
    return db.query(
        """
        SELECT cp.id, cp.start_date, cp.end_date, cp.duration_min,
               cp.charge_energy_added, cp.charge_energy_used, cp.cost,
               cp.start_battery_level, cp.end_battery_level,
               cp.start_rated_range_km, cp.end_rated_range_km,
               a.display_name AS address
        FROM charging_processes cp
        LEFT JOIN addresses a ON a.id = cp.address_id
        WHERE cp.car_id = %(car)s AND cp.end_date IS NOT NULL
        ORDER BY cp.start_date
        """,
        {"car": car_id},
    )


def charges(
    car_id: int, *, limit: int, offset: int
) -> list[dict]:
    return db.query(
        """
        SELECT cp.id, cp.start_date, cp.end_date, cp.duration_min,
               cp.charge_energy_added, cp.charge_energy_used, cp.cost,
               cp.start_battery_level, cp.end_battery_level,
               a.display_name AS address
        FROM charging_processes cp
        LEFT JOIN addresses a ON a.id = cp.address_id
        WHERE cp.car_id = %(car)s AND cp.end_date IS NOT NULL
        ORDER BY cp.start_date DESC
        LIMIT %(limit)s OFFSET %(offset)s
        """,
        {"car": car_id, "limit": limit, "offset": offset},
    )


def charges_count(car_id: int) -> int:
    row = db.one(
        "SELECT COUNT(*) AS n FROM charging_processes WHERE car_id = %(car)s AND end_date IS NOT NULL",
        {"car": car_id},
    )
    return int(row["n"]) if row else 0


def month_energy(car_id: int, *, months_back: int = 0, offset_hours: int = 8) -> dict:
    """某个月的充电账本：充入、从电网取用、电费，用于算充电效率。"""
    start, end = _month_window(months_back, offset_hours)
    row = db.one(
        """
        SELECT COALESCE(SUM(charge_energy_added), 0) AS charged,
               COALESCE(SUM(charge_energy_used), 0)  AS used,
               COALESCE(SUM(cost), 0)                AS cost,
               COUNT(*)                              AS sessions
        FROM charging_processes
        WHERE car_id = %(car)s AND end_date IS NOT NULL
          AND start_date >= %(start)s AND start_date < %(end)s
        """,
        {"car": car_id, "start": start, "end": end},
    ) or {}
    return row


# ------------------------------------------------------------------ 时间线


def drive_intervals(car_id: int, since: datetime) -> list[dict]:
    return db.query(
        """
        SELECT start_date, end_date, distance
        FROM drives
        WHERE car_id = %(car)s AND start_date >= %(since)s AND end_date IS NOT NULL
        ORDER BY start_date
        """,
        {"car": car_id, "since": since},
    )


def charge_intervals(car_id: int, since: datetime) -> list[dict]:
    return db.query(
        """
        SELECT start_date, end_date, charge_energy_added
        FROM charging_processes
        WHERE car_id = %(car)s AND start_date >= %(since)s AND end_date IS NOT NULL
        ORDER BY start_date
        """,
        {"car": car_id, "since": since},
    )


def state_intervals(car_id: int, since: datetime) -> list[dict] | None:
    """车辆状态（在线/睡眠）。没授权或没这张表时返回 None，页面降级而不是报错。"""
    try:
        return db.query(
            """
            SELECT state, start_date, end_date
            FROM states
            WHERE car_id = %(car)s
              AND start_date >= %(since)s
              AND (end_date IS NULL OR end_date > %(since)s)
            ORDER BY start_date
            """,
            {"car": car_id, "since": since},
        )
    except (pg_errors.InsufficientPrivilege, pg_errors.UndefinedTable):
        return None


# ------------------------------------------------------------------ 聚合


def _month_window(months_back: int, offset_hours: int) -> tuple[datetime, datetime]:
    """按「本地月份」切分，再换算回数据库里的 UTC 时间。"""
    local_now = datetime.now(timezone.utc) + timedelta(hours=offset_hours)
    index = local_now.year * 12 + local_now.month - 1 - months_back
    start_local = datetime(index // 12, index % 12 + 1, 1, tzinfo=timezone.utc)
    end_index = index + 1
    end_local = datetime(end_index // 12, end_index % 12 + 1, 1, tzinfo=timezone.utc)
    shift = timedelta(hours=offset_hours)
    return (start_local - shift).replace(tzinfo=None), (end_local - shift).replace(tzinfo=None)


def period_stats(car_id: int, months_back: int = 0, offset_hours: int = 8) -> dict:
    """某个月（0 = 本月，1 = 上月）的里程与行程数。"""
    start, end = _month_window(months_back, offset_hours)
    return db.one(
        """
        SELECT
          COALESCE(SUM(distance), 0) AS km,
          COUNT(*) AS drives,
          COALESCE(SUM(duration_min), 0) AS minutes
        FROM drives
        WHERE car_id = %(car)s AND start_date >= %(start)s AND start_date < %(end)s
        """,
        {"car": car_id, "start": start, "end": end},
    ) or {"km": 0, "drives": 0, "minutes": 0}


def daily_distance(car_id: int, days: int = 30, offset_hours: int = 8) -> list[dict]:
    """按本地时区切天。数据库里存的是 UTC，直接 date_trunc 会把凌晨行程算到前一天。"""
    local_today = (datetime.now(timezone.utc) + timedelta(hours=offset_hours)).date()
    first_local = local_today - timedelta(days=days - 1)
    since_utc = datetime.combine(first_local, datetime.min.time()) - timedelta(hours=offset_hours)
    rows = db.query(
        """
        SELECT to_char((start_date + make_interval(hours => %(offset)s))::date, 'YYYY-MM-DD') AS day,
               COALESCE(SUM(distance), 0) AS km
        FROM drives
        WHERE car_id = %(car)s AND start_date >= %(since)s
        GROUP BY 1 ORDER BY 1
        """,
        {"car": car_id, "since": since_utc, "offset": offset_hours},
    )
    seen = {r["day"]: float(r["km"]) for r in rows}
    return [
        {
            "date": (first_local + timedelta(days=index)).isoformat(),
            "km": round(seen.get((first_local + timedelta(days=index)).isoformat(), 0.0), 1),
        }
        for index in range(days)
    ]


def battery_bundle(car_id: int, nominal_kwh: float) -> dict[str, Any]:
    rows = charging_sessions(car_id)
    capacities = analytics.estimate_capacity(rows)
    ranges = analytics.estimate_range(rows)
    healthy = analytics.health(capacities, nominal_kwh)

    fast = [s for s in capacities if s.is_fast]
    ranges_monthly = analytics.monthly_median([(s.when, s.km) for s in ranges])
    capacity_monthly = analytics.monthly_median([(s.when, s.kwh) for s in capacities])

    recent_range = ranges[-10:]
    range_est = round(median([r.km for r in recent_range]), 0) if recent_range else None

    return {
        "nominal_kwh": nominal_kwh,
        "health_pct": healthy["pct"],
        "capacity_kwh": healthy["kwh"],
        "capacity_samples": len(capacities),
        "range_km": range_est,
        "range_samples": len(ranges),
        "fast_share": round(len(fast) / len(capacities) * 100, 1) if capacities else None,
        "capacity_series": [
            {"month": item["month"], "kwh": item["value"], "n": item["n"]}
            for item in capacity_monthly
        ],
        "range_series": ranges_monthly,
        "soc_histogram": analytics.soc_histogram(rows),
        "kwh_per_km": (healthy["kwh"] / range_est) if healthy["kwh"] and range_est else None,
    }
