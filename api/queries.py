"""所有 SQL 都集中在这里，方便你按自己的 TeslaMate 版本微调。"""

from __future__ import annotations

import math
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
               cp.start_ideal_range_km, cp.end_ideal_range_km,
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
               a.display_name AS address, a.latitude, a.longitude,
               g.id AS geofence_id, g.name AS geofence_name,
               g.billing_type AS geofence_billing_type,
               g.cost_per_unit AS geofence_cost_per_unit
        FROM charging_processes cp
        LEFT JOIN addresses a ON a.id = cp.address_id
        LEFT JOIN geofences g ON g.id = cp.geofence_id
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


# ------------------------------------------------------------------ 显示设置

# TeslaMate settings 表的枚举字段，取值必须和数据库里的 enum 完全一致
SETTING_ENUMS: dict[str, set[str]] = {
    "unit_of_length": {"km", "mi"},
    "unit_of_temperature": {"C", "F"},
    "preferred_range": {"rated", "ideal"},
    "unit_of_pressure": {"bar", "psi"},
    "theme_mode": {"system", "light", "dark"},
}
# 自由文本字段
SETTING_TEXT: set[str] = {"language", "base_url", "grafana_url"}
# TeslaMate 4.4 自带的语言（容器 priv/gettext 下的目录名）
SETTING_LANGUAGES: list[tuple[str, str]] = [
    ("zh_Hans", "简体中文"),
    ("en", "English"),
    ("de", "Deutsch"),
    ("fr", "Français"),
    ("es", "Español"),
    ("it", "Italiano"),
    ("pt", "Português"),
    ("nl", "Nederlands"),
    ("sv", "Svenska"),
    ("nb", "Norsk"),
    ("da", "Dansk"),
    ("fi", "Suomi"),
    ("pl", "Polski"),
    ("ru", "Русский"),
    ("uk", "Українська"),
    ("tr", "Türkçe"),
    ("ja", "日本語"),
    ("ko", "한국어"),
    ("th", "ไทย"),
    ("hu", "Magyar"),
    ("ca", "Català"),
]

SETTING_COLUMNS = (
    "unit_of_length, unit_of_temperature, preferred_range, unit_of_pressure, "
    "language, theme_mode, base_url, grafana_url"
)


def settings() -> dict[str, Any]:
    """读取 TeslaMate 的显示设置（settings 表全局一行）。"""
    row = db.one(f"SELECT {SETTING_COLUMNS} FROM settings ORDER BY id LIMIT 1")
    return dict(row) if row else {}


def update_settings(values: dict[str, Any]) -> dict[str, Any]:
    """更新显示设置，写回 TeslaMate 的 settings 表，两边保持一致。

    只接受白名单里的字段，枚举值必须合法；任何非法输入都直接报错，
    不会写坏 TeslaMate 的配置。
    """
    assignments: list[str] = []
    params: dict[str, Any] = {}
    for key, value in values.items():
        if key in SETTING_ENUMS:
            if value not in SETTING_ENUMS[key]:
                raise ValueError(f"{key} 的取值必须是 {'/'.join(sorted(SETTING_ENUMS[key]))} 之一")
        elif key in SETTING_TEXT:
            if value is not None and not isinstance(value, str):
                raise ValueError(f"{key} 必须是文本")
            value = (value or "").strip()[:512]
        else:
            raise ValueError(f"不支持的设置项：{key}")
        assignments.append(f"{key} = %({key})s")
        params[key] = value
    if not assignments:
        return settings()
    # 只用 settings 表自身定位目标行：写账号没有 cars 的读权限，
    # 这里不能拿 cars.settings_id 做子查询。
    sql = (
        f"UPDATE settings SET {', '.join(assignments)}, updated_at = now() "
        "WHERE id = (SELECT min(id) FROM settings)"
    )
    db.execute(sql, params)
    return settings()


# ------------------------------------------------------------------ 收藏点

# TeslaMate 的收藏点 = geofences。半径 + 定价，命中圈内的充电按此计价。
GEOFENCE_BILLING_TYPES = {"per_kwh", "per_minute"}
GEOFENCE_RADIUS_RANGE = (10, 5000)


def geofences() -> list[dict[str, Any]]:
    """收藏点列表 + 每个点的充电统计。

    统计口径跟 TeslaMate 一致：按 charging_processes.geofence_id 关联，
    费用是库里已经算好的 cost。
    """
    return db.query(
        """
        SELECT g.id, g.name, g.latitude, g.longitude, g.radius,
               g.cost_per_unit, g.session_fee, g.billing_type,
               g.inserted_at, g.updated_at,
               count(cp.id) AS charges,
               count(cp.cost) AS priced_charges,
               sum(cp.charge_energy_added) AS energy_added,
               sum(cp.charge_energy_used) AS energy_used,
               sum(cp.cost) AS total_cost,
               sum(cp.duration_min) AS total_minutes,
               max(cp.start_date) AS last_charge_at
        FROM geofences g
        LEFT JOIN charging_processes cp ON cp.geofence_id = g.id
        GROUP BY g.id
        ORDER BY g.id
        """
    )


def geofence(geofence_id: int) -> dict[str, Any] | None:
    row = db.one("SELECT * FROM geofences WHERE id = %(id)s", {"id": geofence_id})
    return row


def create_geofence(values: dict[str, Any]) -> dict[str, Any]:
    """新建收藏点，写回 geofences 表，TeslaMate 面板那边同步显示。"""
    params = _validate_geofence(values)
    row = db.one_write(
        """
        INSERT INTO geofences (name, latitude, longitude, radius,
                               cost_per_unit, session_fee, billing_type,
                               inserted_at, updated_at)
        VALUES (%(name)s, %(latitude)s, %(longitude)s, %(radius)s,
                %(cost_per_unit)s, %(session_fee)s, %(billing_type)s,
                now(), now())
        RETURNING id, name, latitude, longitude, radius,
                  cost_per_unit, session_fee, billing_type, inserted_at, updated_at
        """,
        params,
    )
    return row or {}


def update_geofence(geofence_id: int, values: dict[str, Any]) -> dict[str, Any]:
    """改收藏点。只更新传了的字段。"""
    current = geofence(geofence_id)
    if current is None:
        raise LookupError("收藏点不存在")
    merged = {
        "name": current["name"],
        "latitude": current["latitude"],
        "longitude": current["longitude"],
        "radius": current["radius"],
        "cost_per_unit": current["cost_per_unit"],
        "session_fee": current["session_fee"],
        "billing_type": current["billing_type"],
    }
    merged.update({k: v for k, v in values.items() if v is not None or k in values})
    params = _validate_geofence(merged)
    row = db.one_write(
        """
        UPDATE geofences
        SET name = %(name)s, latitude = %(latitude)s, longitude = %(longitude)s,
            radius = %(radius)s, cost_per_unit = %(cost_per_unit)s,
            session_fee = %(session_fee)s, billing_type = %(billing_type)s,
            updated_at = now()
        WHERE id = %(id)s
        RETURNING id, name, latitude, longitude, radius,
                  cost_per_unit, session_fee, billing_type, inserted_at, updated_at
        """,
        {**params, "id": geofence_id},
    )
    return row or {}


def delete_geofence(geofence_id: int) -> None:
    """删收藏点。charging_processes.geofence_id 由外键 ON DELETE SET NULL 自动置空，
    已经算好的 cost 保留不动（历史账单不该因为改了收藏点就消失）。"""
    db.execute("DELETE FROM geofences WHERE id = %(id)s", {"id": geofence_id})


def _validate_geofence(values: dict[str, Any]) -> dict[str, Any]:
    """校验收藏点字段，返回可直接入库的参数。"""
    name = str(values.get("name") or "").strip()
    if not name:
        raise ValueError("收藏点名称不能为空")
    if len(name) > 64:
        raise ValueError("收藏点名称过长")

    # 前端用 lat/lng，数据库列名是 latitude/longitude，两种都认
    raw_lat = values.get("latitude", values.get("lat"))
    raw_lng = values.get("longitude", values.get("lng"))
    try:
        latitude = float(raw_lat)
        longitude = float(raw_lng)
    except (TypeError, ValueError):
        raise ValueError("缺少有效的经纬度")
    if not -90 <= latitude <= 90:
        raise ValueError("纬度必须在 -90 ~ 90 之间")
    if not -180 <= longitude <= 180:
        raise ValueError("经度必须在 -180 ~ 180 之间")

    try:
        radius = int(values["radius"])
    except (KeyError, TypeError, ValueError):
        raise ValueError("半径必须是整数")
    low, high = GEOFENCE_RADIUS_RANGE
    if not low <= radius <= high:
        raise ValueError(f"半径必须在 {low} ~ {high} 米之间")

    billing_type = values.get("billing_type") or "per_kwh"
    if billing_type not in GEOFENCE_BILLING_TYPES:
        raise ValueError("计费方式必须是 per_kwh 或 per_minute")

    cost_per_unit = values.get("cost_per_unit")
    cost_per_unit = None if cost_per_unit in (None, "") else float(cost_per_unit)
    if cost_per_unit is not None and cost_per_unit < 0:
        raise ValueError("单价不能为负")

    session_fee = values.get("session_fee")
    session_fee = None if session_fee in (None, "") else float(session_fee)
    if session_fee is not None and session_fee < 0:
        raise ValueError("服务费不能为负")

    if cost_per_unit is None and session_fee is None:
        raise ValueError("单价和服务费至少填一个，否则这个收藏点不会计费")

    return {
        "name": name,
        "latitude": latitude,
        "longitude": longitude,
        "radius": radius,
        "cost_per_unit": cost_per_unit,
        "session_fee": session_fee,
        "billing_type": billing_type,
    }


# TeslaMate 计算单次充电费用的公式（locations.ex 的 calculate_charge_costs）。
# per_kwh 取「取电量与充入量的较大值」——车载电表中途归零时以取电量为准。
# 行别名由调用方传入，方便在外层 UPDATE 里直接引用同一行。
def cost_formula(row_alias: str = "c") -> str:
    return f"""
    CASE
      WHEN g.session_fee IS NULL AND g.cost_per_unit IS NULL THEN NULL
      WHEN g.billing_type = 'per_kwh' THEN
        COALESCE(g.session_fee, 0)
        + COALESCE(g.cost_per_unit * GREATEST({row_alias}.charge_energy_used,
                                               {row_alias}.charge_energy_added), 0)
      WHEN g.billing_type = 'per_minute' THEN
        COALESCE(g.session_fee, 0) + COALESCE(g.cost_per_unit * {row_alias}.duration_min, 0)
      ELSE NULL
    END
"""


def link_geofence_charges(geofence_id: int) -> int:
    """把落在收藏点圈内、但还没关联的历史充电关联进来。

    TeslaMate 自己只在写入充电记录时关联围栏，新建收藏点不会回溯，
    这里补上这一步——语义跟它当时做的事一致（按位置是否落在半径内判断）。
    返回关联了多少条。
    """
    fence = geofence(geofence_id)
    if fence is None:
        return 0
    # 命中哪些充电用只读连接算——positions 是最大的表，不给写账号开它的读权限。
    # 写账号只拿到一串 id 去更新，不碰坐标。
    rows = db.query(
        """
        SELECT cp.id
        FROM charging_processes cp
        JOIN positions p ON p.id = cp.position_id
        WHERE cp.geofence_id IS NULL
          AND 6371000 * 2 * asin(sqrt(
                power(sin(radians(%(lat)s - p.latitude) / 2), 2)
                + cos(radians(p.latitude)) * cos(radians(%(lat)s))
                * power(sin(radians(%(lng)s - p.longitude) / 2), 2)
              )) <= %(radius)s
        """,
        {
            "lat": float(fence["latitude"]),
            "lng": float(fence["longitude"]),
            "radius": int(fence["radius"]),
        },
    )
    ids = [int(row["id"]) for row in rows]
    if not ids:
        return 0
    return db.execute(
        """
        UPDATE charging_processes
        SET geofence_id = %(id)s
        WHERE id = ANY(%(ids)s) AND geofence_id IS NULL
        """,
        {"id": geofence_id, "ids": ids},
    )


def recalculate_geofence_costs(geofence_id: int, *, force: bool = False) -> int:
    """按收藏点当前定价重算历史充电费用。

    force=False 时只补空缺（跟 TeslaMate 一致，不动已有的账）；
    force=True 时全部按新价重算。返回改动的条数。
    """
    condition = "" if force else "AND cp.cost IS NULL"
    return db.execute(
        f"""
        UPDATE charging_processes cp
        SET cost = (
            SELECT {cost_formula("cp")}
            FROM geofences g
            WHERE g.id = cp.geofence_id
        )
        WHERE cp.geofence_id = %(id)s {condition}
        """,
        {"id": geofence_id},
    )


def unpriced_charges_in_geofence(geofence_id: int) -> int:
    """圈内有多少条充电还没算价（用来提示用户「还能补算多少条」）。"""
    row = db.one(
        """
        SELECT count(*) AS n
        FROM charging_processes cp
        JOIN positions p ON p.id = cp.position_id
        JOIN geofences g ON g.id = %(id)s
        WHERE cp.cost IS NULL
          AND 6371000 * 2 * asin(sqrt(
            power(sin(radians(g.latitude - p.latitude) / 2), 2)
            + cos(radians(p.latitude)) * cos(radians(g.latitude))
            * power(sin(radians(g.longitude - p.longitude) / 2), 2)
          )) <= g.radius
        """,
        {"id": geofence_id},
    )
    return int(row["n"]) if row else 0


# ------------------------------------------------------------------ 时间线


def drive_intervals(car_id: int, since: datetime) -> list[dict]:
    return db.query(
        f"""
        SELECT {DRIVE_COLUMNS}
        {DRIVE_JOINS}
        WHERE d.car_id = %(car)s AND d.start_date >= %(since)s AND d.end_date IS NOT NULL
        ORDER BY d.start_date
        """,
        {"car": car_id, "since": since},
    )


def charge_intervals(car_id: int, since: datetime) -> list[dict]:
    return db.query(
        """
        SELECT cp.start_date, cp.end_date, cp.charge_energy_added,
               a.display_name, a.latitude, a.longitude,
               g.id AS geofence_id, g.name AS geofence_name
        FROM charging_processes cp
        LEFT JOIN addresses a ON a.id = cp.address_id
        LEFT JOIN geofences g ON g.id = cp.geofence_id
        WHERE cp.car_id = %(car)s AND cp.start_date >= %(since)s AND cp.end_date IS NOT NULL
        ORDER BY cp.start_date
        """,
        {"car": car_id, "since": since},
    )


def stop_intervals(
    car_id: int,
    since: datetime,
    until: datetime,
    *,
    min_minutes: int = 15,
) -> list[dict]:
    """停留段：两次行程之间的空档。

    TeslaMate 的 states 只有 online/offline，拿不到「停在哪」；但 drives 给了
    每段行程的起止时间，中间那段路就是车停着的时间。坐标取行程结束时刻附近
    的采样点（比用零速点判断稳得多——停车时 GPS 速度会飘，零速点会被噪声切碎）。

    末尾那次行程之后到现在也算一段停留，车还停在那儿。
    """
    return db.query(
        """
        WITH d AS (
            SELECT dr.end_date,
                   LEAD(dr.start_date) OVER (ORDER BY dr.start_date) AS next_start
            FROM drives dr
            WHERE dr.car_id = %(car)s AND dr.end_date IS NOT NULL
        )
        SELECT d.end_date AS start_date,
               COALESCE(d.next_start, %(until)s::timestamp) AS end_date,
               p.latitude, p.longitude
        FROM d
        LEFT JOIN LATERAL (
            SELECT latitude, longitude
            FROM positions
            WHERE car_id = %(car)s
              AND date BETWEEN d.end_date - interval '3 minutes' AND d.end_date + interval '3 minutes'
              AND latitude IS NOT NULL
            ORDER BY abs(EXTRACT(EPOCH FROM (date - d.end_date)))
            LIMIT 1
        ) p ON true
        WHERE (COALESCE(d.next_start, %(until)s::timestamp) - d.end_date) >= make_interval(mins => %(min)s)
          AND d.end_date < %(until)s::timestamp
          AND COALESCE(d.next_start, %(until)s::timestamp) > %(since)s::timestamp
        ORDER BY d.end_date
        """,
        {
            "car": car_id,
            "since": since,
            "until": until,
            "min": min_minutes,
        },
    )


def place_names(points: list[tuple[float, float]]) -> list[dict | None]:
    """给一组坐标找地点名：围栏优先，其次附近的逆地理编码地址。

    围栏是用户自己起的名字（"公司-京东总部"），比地址更准；地址表是 TeslaMate
    逆向地理编码的结果，命中 200 米内才算。两次查询取回候选，匹配在内存里做，
    避免每个点查一次库。
    """
    if not points:
        return []
    fences = db.query(
        "SELECT name, latitude, longitude, radius FROM geofences WHERE latitude IS NOT NULL"
    )
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    addresses = db.query(
        """
        SELECT display_name, latitude, longitude
        FROM addresses
        WHERE latitude BETWEEN %(min_lat)s AND %(max_lat)s
          AND longitude BETWEEN %(min_lon)s AND %(max_lon)s
        LIMIT 5000
        """,
        {
            "min_lat": min(lats) - 0.02,
            "max_lat": max(lats) + 0.02,
            "min_lon": min(lons) - 0.02,
            "max_lon": max(lons) + 0.02,
        },
    )

    result: list[dict | None] = []
    for lat, lon in points:
        hit = None
        for fence in fences:
            distance = _distance_km(lat, lon, float(fence["latitude"]), float(fence["longitude"]))
            if distance * 1000 <= float(fence["radius"]):
                hit = {"name": fence["name"], "source": "geofence"}
                break
        if hit is None:
            best = None
            best_distance = 0.2
            for address in addresses:
                distance = _distance_km(lat, lon, float(address["latitude"]), float(address["longitude"]))
                if distance < best_distance:
                    best_distance = distance
                    best = address
            if best is not None:
                hit = {"name": best["display_name"], "source": "address"}
        result.append(hit)
    return result


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """两点球面距离（公里）。"""
    radius = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    h = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * (
        math.sin(d_lon / 2) ** 2
    )
    return 2 * radius * math.asin(math.sqrt(h))



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


def battery_bundle(
    car_id: int, nominal_kwh: float, *, preferred_range: str = "rated"
) -> dict[str, Any]:
    rows = charging_sessions(car_id)
    capacities = analytics.estimate_capacity(rows)
    ranges = analytics.estimate_range(rows, preferred=preferred_range)
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
