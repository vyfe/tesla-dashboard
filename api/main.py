"""FastAPI 应用：只读查询 TeslaMate 的 PostgreSQL，输出看板所需的 JSON。"""

from __future__ import annotations

import base64
import hmac
import logging
import os
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db, queries

NOMINAL_KWH = float(os.environ.get("NOMINAL_KWH", "75.0"))
# TeslaMate 的 timestamp 列存的是 UTC；这里补上时区标识，浏览器才能正确换算成本地时间。
TZ_OFFSET_HOURS = int(os.environ.get("TZ_OFFSET_HOURS", "8"))
DEFAULT_CAR = os.environ.get("DEFAULT_CAR_ID")
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parent.parent / "web" / "dist"))
_STATIC_ROOT = STATIC_DIR.resolve()

# 生产默认不暴露 OpenAPI；本地调试显式 ENABLE_DOCS=1。
ENABLE_DOCS = os.environ.get("ENABLE_DOCS", "0").lower() in {"1", "true", "yes", "on"}
# HTTP Basic 登录：两个都填才生效，留空则完全依赖内网 / 反向代理。
AUTH_USER = os.environ.get("DASHBOARD_USER", "")
AUTH_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "")
AUTH_ENABLED = bool(AUTH_USER and AUTH_PASSWORD)
# 健康检查给容器探针用，不含任何业务数据或版本信息。
PUBLIC_PATHS = frozenset({"/api/health"})

# 对外分享的 demo 入口：不需要登录，只有界面，数据全是生成的假数据。
# 默认关闭——打开前请确认 /demo 下的产物确实是 mock 构建。
DEMO_ENABLED = os.environ.get("DEMO_ENABLED", "0").lower() in {"1", "true", "yes", "on"}
DEMO_PREFIX = "/demo"
DEMO_STATIC_DIR = Path(
    os.environ.get("DEMO_STATIC_DIR", Path(__file__).resolve().parent.parent / "web" / "dist-demo")
)

if bool(AUTH_USER) != bool(AUTH_PASSWORD):
    logging.getLogger("teslamate.dashboard").warning(
        "DASHBOARD_USER 与 DASHBOARD_PASSWORD 只配了一个，登录未启用——看板当前是公开的"
    )

app = FastAPI(
    title="TeslaMate Dashboard",
    docs_url="/api/docs" if ENABLE_DOCS else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if ENABLE_DOCS else None,
)


def _basic_auth_ok(header: str | None, user: str, password: str) -> bool:
    """校验 HTTP Basic 头；用户名和密码都用常量时间比较，避免时序侧信道。"""
    if not header:
        return False
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "basic" or not token:
        return False
    try:
        decoded = base64.b64decode(token.strip(), validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return False
    username, sep, given = decoded.partition(":")
    if not sep:
        return False
    # compare_digest 只接受 ASCII，先转 bytes 才能支持中文密码。
    return hmac.compare_digest(username.encode("utf-8"), user.encode("utf-8")) and hmac.compare_digest(
        given.encode("utf-8"), password.encode("utf-8")
    )


def _is_demo_path(path: str) -> bool:
    """demo 前缀下的静态资源不需要登录。

    只认 /demo 本身和 /demo/ 开头的路径——/api/* 永远要鉴权，
    否则就等于把真实数据也放开了。
    """
    return DEMO_ENABLED and (path == DEMO_PREFIX or path.startswith(DEMO_PREFIX + "/"))


@app.middleware("http")
async def guard(request: Request, call_next):
    """鉴权 + 安全响应头。放在 CORS 之内，CORS 仍然是最外层。"""
    path = request.url.path
    if (
        AUTH_ENABLED
        and request.method != "OPTIONS"
        and path not in PUBLIC_PATHS
        and not _is_demo_path(path)
        and not _basic_auth_ok(request.headers.get("authorization"), AUTH_USER, AUTH_PASSWORD)
    ):
        return JSONResponse(
            {"detail": "需要登录"},
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="tesla-dashboard", charset="UTF-8"'},
        )

    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), camera=(), microphone=()")
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",") if o.strip()],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ 工具


def _num(value: Any, digits: int = 1) -> float | None:
    if value is None:
        return None
    try:
        return round(float(value), digits)
    except (TypeError, ValueError):
        return None


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def _clean(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean(v) for v in obj]
    return obj


def _resolve_car(car: int | None) -> dict:
    cars = queries.list_cars()
    if not cars:
        raise HTTPException(404, "库里还没有车辆数据，TeslaMate 是否已经同步过？")
    if car is not None:
        match = next((c for c in cars if c["id"] == car), None)
        if match is None:
            raise HTTPException(404, f"没有 id={car} 的车辆")
        return match
    if DEFAULT_CAR:
        match = next((c for c in cars if str(c["id"]) == str(DEFAULT_CAR)), None)
        if match:
            return match
    return cars[0]


def _place(geofence: str | None, address: str | None) -> str:
    if geofence:
        return geofence
    if address:
        return address.split(",")[0].strip()
    return "未知位置"


def _shape_drive(row: dict, kwh_per_km: float | None) -> dict:
    distance = _num(row.get("distance"))
    duration = row.get("duration_min") or 0
    energy = None
    start_rated, end_rated = row.get("start_rated_range_km"), row.get("end_rated_range_km")
    if None not in (start_rated, end_rated) and kwh_per_km:
        energy = round((float(start_rated) - float(end_rated)) * kwh_per_km, 2)
    return {
        "id": row["id"],
        "started_at": _iso(row.get("start_date")),
        "ended_at": _iso(row.get("end_date")),
        "distance_km": distance,
        "duration_min": duration,
        "avg_speed": round(distance / duration * 60, 1) if distance and duration else None,
        "max_speed": row.get("speed_max"),
        "energy_kwh": energy,
        "consumption": round(energy / distance * 100, 1) if energy and distance else None,
        "from": _place(row.get("start_geofence"), row.get("start_address")),
        "to": _place(row.get("end_geofence"), row.get("end_address")),
        "from_raw": row.get("start_address"),
        "to_raw": row.get("end_address"),
        "outside_temp": _num(row.get("outside_temp_avg")),
        "ascent": row.get("ascent"),
        "descent": row.get("descent"),
    }


def _shape_charge(row: dict) -> dict:
    kwh = _num(row.get("charge_energy_added"), 2)
    used = _num(row.get("charge_energy_used"), 2)
    duration = row.get("duration_min") or 0
    power = round(kwh / (duration / 60), 1) if kwh and duration else None
    return {
        "id": row["id"],
        "started_at": _iso(row.get("start_date")),
        "ended_at": _iso(row.get("end_date")),
        "kwh": kwh,
        "used_kwh": used,
        "efficiency": round(kwh / used * 100, 1) if kwh and used else None,
        "duration_min": duration,
        "power": power,
        "is_fast": (power or 0) > 15,
        "start_soc": row.get("start_battery_level"),
        "end_soc": row.get("end_battery_level"),
        "cost": _num(row.get("cost"), 2),
        "address": _place(None, row.get("address")),
        "lat": _num(row.get("latitude"), 6),
        "lng": _num(row.get("longitude"), 6),
    }


# ------------------------------------------------------------------ 路由


@app.get("/api/health")
def health() -> dict:
    # 探针只关心数据库是否可达；不回显库名、版本，避免白送指纹。
    db.ping()
    return {"ok": True}


@app.get("/api/meta")
def meta() -> dict:
    cars = queries.list_cars()
    first = cars[0]["id"] if cars else None
    return _clean(
        {
            "cars": [
                {
                    "id": c["id"],
                    "name": c["name"] or "我的特斯拉",
                    "model": c.get("marketing_name") or c.get("model"),
                    "trim": c.get("trim_badging"),
                    "vin": c.get("vin"),
                }
                for c in cars
            ],
            "range": queries.data_range(first) if first else {},
            "nominal_kwh": NOMINAL_KWH,
        }
    )


@app.get("/api/status")
def status(car: int | None = None) -> dict:
    """车辆最近一次上报的状态，用于首屏「现在怎么样」。

    数据来自 TeslaMate 存下来的 positions，不直连特斯拉 API，
    所以会有几十秒到几分钟的延迟，页面上如实标注更新时间。
    """
    vehicle = _resolve_car(car)
    position = queries.latest_position(vehicle["id"])
    charging = queries.active_charge(vehicle["id"]) is not None
    if not position:
        return {
            "car_id": vehicle["id"],
            "available": False,
            "soc": None,
            "range_km": None,
            "odometer_km": None,
            "updated_at": None,
            "age_min": None,
            "charging": charging,
        }

    updated = position.get("date")
    age_min = None
    if isinstance(updated, datetime):
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
        age_min = max(0, int((datetime.now(timezone.utc) - updated).total_seconds() // 60))

    return _clean(
        {
            "car_id": vehicle["id"],
            "available": True,
            "soc": position.get("battery_level"),
            "usable_soc": position.get("usable_battery_level"),
            "range_km": _num(position.get("rated_battery_range_km"), 0),
            "odometer_km": _num(position.get("odometer"), 0),
            "updated_at": _iso(updated),
            "age_min": age_min,
            "charging": charging,
        }
    )


@app.get("/api/timeline")
def timeline(car: int | None = None, days: int = Query(7, ge=1, le=30)) -> dict:
    """最近 N 天的行驶 / 充电 / 停留 / 车辆状态区间，前端画成时间带。"""
    vehicle = _resolve_car(car)
    until = datetime.now(timezone.utc)
    since = until - timedelta(days=days)
    states = queries.state_intervals(vehicle["id"], since)
    charges = queries.charge_intervals(vehicle["id"], since)
    stops = queries.stop_intervals(vehicle["id"], since, until)
    # 只有带坐标的停留段才能配地点名，过滤后再和 place_names 一一对应
    stops = [row for row in stops if row["latitude"] is not None and row["longitude"] is not None]
    stop_places = queries.place_names(
        [(float(row["latitude"]), float(row["longitude"])) for row in stops]
    )
    return _clean(
        {
            "days": days,
            "since": _iso(since),
            "until": _iso(until),
            "drives": [
                {
                    "start": _iso(row.get("start_date")),
                    "end": _iso(row.get("end_date")),
                    "distance_km": _num(row.get("distance")),
                    "from": _place(row.get("start_geofence"), row.get("start_address")),
                    "to": _place(row.get("end_geofence"), row.get("end_address")),
                }
                for row in queries.drive_intervals(vehicle["id"], since)
            ],
            "charges": [
                {
                    "start": _iso(row.get("start_date")),
                    "end": _iso(row.get("end_date")),
                    "kwh": _num(row.get("charge_energy_added")),
                    "lat": _num(row.get("latitude"), 6),
                    "lng": _num(row.get("longitude"), 6),
                    "name": row.get("display_name"),
                }
                for row in charges
            ],
            "stops": [
                {
                    "start": _iso(row.get("start_date")),
                    "end": _iso(row.get("end_date")),
                    "minutes": _num((row["end_date"] - row["start_date"]).total_seconds() / 60, 0),
                    "lat": _num(row.get("latitude"), 6),
                    "lng": _num(row.get("longitude"), 6),
                    "name": place["name"] if place else None,
                    "source": place["source"] if place else None,
                }
                for row, place in zip(stops, stop_places)
            ],
            "states": None
            if states is None
            else [
                {
                    "state": row.get("state"),
                    "start": _iso(row.get("start_date")),
                    "end": _iso(row.get("end_date")),
                }
                for row in states
            ],
            "states_available": states is not None,
        }
    )


@app.get("/api/overview")
def overview(car: int | None = None) -> dict:
    vehicle = _resolve_car(car)
    battery = queries.battery_bundle(vehicle["id"], NOMINAL_KWH)
    kwh_per_km = battery.get("kwh_per_km") or (
        float(vehicle["efficiency"]) if vehicle.get("efficiency") else None
    )

    month = queries.period_stats(vehicle["id"], 0, TZ_OFFSET_HOURS)
    prev = queries.period_stats(vehicle["id"], 1, TZ_OFFSET_HOURS)
    km = _num(month.get("km")) or 0.0
    prev_km = _num(prev.get("km")) or 0.0

    energy = queries.month_energy(vehicle["id"], months_back=0, offset_hours=TZ_OFFSET_HOURS)
    charged = _num(energy.get("charged")) or 0.0
    grid = _num(energy.get("used")) or 0.0
    cost = _num(energy.get("cost")) or 0.0

    return _clean(
        {
            "car": {
                "id": vehicle["id"],
                "name": vehicle["name"] or "我的特斯拉",
                "model": vehicle.get("marketing_name") or vehicle.get("model"),
                "trim": vehicle.get("trim_badging"),
            },
            "kpis": {
                "month_km": round(km, 1),
                "prev_month_km": round(prev_km, 1),
                "month_drives": int(month.get("drives") or 0),
                "avg_trip_km": round(km / month["drives"], 1) if month.get("drives") else None,
                "consumption": round(kwh_per_km * 100, 1) if kwh_per_km else None,
                "battery_health": battery.get("health_pct"),
                "capacity_kwh": battery.get("capacity_kwh"),
                "nominal_kwh": NOMINAL_KWH,
            },
            "ledger": {
                "charged_kwh": round(charged, 1),
                "grid_kwh": round(grid, 1) if grid else None,
                "consumed_kwh": round(km * kwh_per_km, 1) if kwh_per_km else None,
                "cost": round(cost, 2),
                "cost_per_kwh": round(cost / charged, 2) if charged else None,
                "efficiency_pct": round(charged / grid * 100, 1) if charged and grid else None,
                "sessions": int(energy.get("sessions") or 0),
            },
            "daily": queries.daily_distance(vehicle["id"], 45, TZ_OFFSET_HOURS),
            "recent_drives": [
                _shape_drive(row, kwh_per_km)
                for row in queries.drives(vehicle["id"], limit=8, offset=0)
            ],
            "recent_charges": [
                _shape_charge(row) for row in queries.charges(vehicle["id"], limit=5, offset=0)
            ],
            "battery": battery,
        }
    )


@app.get("/api/drives")
def drives(
    car: int | None = None,
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    vehicle = _resolve_car(car)
    battery = queries.battery_bundle(vehicle["id"], NOMINAL_KWH)
    kwh_per_km = battery.get("kwh_per_km")
    rows = queries.drives(
        vehicle["id"], limit=limit, offset=offset, date_from=date_from, date_to=date_to
    )
    total = queries.drives_count(vehicle["id"], date_from=date_from, date_to=date_to)
    return _clean(
        {
            "total": total,
            "items": [_shape_drive(row, kwh_per_km) for row in rows],
            "kwh_per_km": kwh_per_km,
        }
    )


@app.get("/api/drives/{drive_id}")
def drive_detail(drive_id: int, car: int | None = None) -> dict:
    vehicle = _resolve_car(car)
    row = queries.drive(vehicle["id"], drive_id)
    if row is None:
        raise HTTPException(404, "行程不存在")
    battery = queries.battery_bundle(vehicle["id"], NOMINAL_KWH)
    series = queries.drive_positions(drive_id)
    return _clean(
        {
            "drive": _shape_drive(row, battery.get("kwh_per_km")),
            "series": [
                {
                    "t": _iso(p.get("date")),
                    "speed": p.get("speed"),
                    "power": p.get("power"),
                    "soc": p.get("battery_level"),
                    "elevation": p.get("elevation"),
                    "odometer": _num(p.get("odometer"), 2),
                    # WGS-84 原始坐标，底图需要 GCJ-02 时由前端换算
                    "lat": _num(p.get("latitude"), 6),
                    "lng": _num(p.get("longitude"), 6),
                }
                for p in series
            ],
        }
    )


@app.get("/api/battery")
def battery(car: int | None = None) -> dict:
    vehicle = _resolve_car(car)
    return _clean(queries.battery_bundle(vehicle["id"], NOMINAL_KWH))


@app.get("/api/charges")
def charges(
    car: int | None = None,
    limit: int = Query(30, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    vehicle = _resolve_car(car)
    rows = queries.charges(vehicle["id"], limit=limit, offset=offset)
    total = queries.charges_count(vehicle["id"])
    items = [_shape_charge(row) for row in rows]
    total_kwh = round(sum(i["kwh"] or 0 for i in items), 1)
    sessions = queries.charging_sessions(vehicle["id"])
    total_kwh_all = 0.0
    total_used_all = 0.0
    total_cost_all = 0.0
    fast_count = 0
    for session in sessions:
        added = float(session.get("charge_energy_added") or 0)
        total_kwh_all += added
        total_used_all += float(session.get("charge_energy_used") or 0)
        total_cost_all += float(session.get("cost") or 0)
        duration = session.get("duration_min") or 0
        if duration and added / (duration / 60) > 15:
            fast_count += 1

    monthly: dict[str, dict] = {}
    for session in sessions:
        when = session.get("start_date")
        if not when or session.get("charge_energy_added") is None:
            continue
        bucket = monthly.setdefault(
            when.strftime("%Y-%m"), {"month": when.strftime("%Y-%m"), "kwh": 0.0, "n": 0, "cost": 0.0}
        )
        bucket["kwh"] = round(bucket["kwh"] + float(session["charge_energy_added"]), 1)
        bucket["cost"] = round(bucket["cost"] + float(session.get("cost") or 0), 2)
        bucket["n"] += 1
    return _clean(
        {
            "total": total,
            "items": items,
            "page_kwh": total_kwh,
            "total_kwh": round(total_kwh_all, 1),
            "total_used_kwh": round(total_used_all, 1) if total_used_all else None,
            "total_cost": round(total_cost_all, 2),
            "efficiency_pct": round(total_kwh_all / total_used_all * 100, 1) if total_used_all else None,
            "avg_kwh": round(total_kwh_all / len(sessions), 1) if sessions else None,
            "fast_share": round(fast_count / len(sessions) * 100, 1) if sessions else None,
            "monthly": [monthly[key] for key in sorted(monthly)][-12:],
        }
    )


# ------------------------------------------------------------------ 静态资源


def _static_file(full_path: str, root: Path | None = None) -> Path | None:
    """只允许命中 root 内部的文件，挡住 ../ 与绝对路径穿越。

    root 默认取主站的静态目录；demo 用自己的目录传进来。
    """
    base = (root or _STATIC_ROOT).resolve()
    if not full_path:
        return None
    candidate = (base / full_path).resolve()
    if not candidate.is_relative_to(base):
        return None
    return candidate if candidate.is_file() else None


# demo 路由必须注册在下面的 SPA catch-all 之前，否则会被它抢走。
if DEMO_ENABLED:
    if DEMO_STATIC_DIR.exists():
        _DEMO_ROOT = DEMO_STATIC_DIR.resolve()

        if (_DEMO_ROOT / "assets").exists():
            app.mount("/demo/assets", StaticFiles(directory=_DEMO_ROOT / "assets"), name="demo-assets")

        @app.get(DEMO_PREFIX)
        @app.get(DEMO_PREFIX + "/{full_path:path}")
        def demo_spa(full_path: str = "") -> Any:
            candidate = _static_file(full_path, _DEMO_ROOT)
            if candidate is not None:
                return FileResponse(candidate)
            index = _DEMO_ROOT / "index.html"
            if index.exists():
                return FileResponse(index)
            return JSONResponse(
                {"detail": "demo 前端还没构建，先执行 npm run build:demo"}, status_code=404
            )

    else:

        @app.get(DEMO_PREFIX)
        @app.get(DEMO_PREFIX + "/{full_path:path}")
        def demo_missing(full_path: str = "") -> Any:
            return JSONResponse(
                {"detail": "demo 前端还没构建，先执行 npm run build:demo"}, status_code=404
            )

else:

    @app.get(DEMO_PREFIX)
    @app.get(DEMO_PREFIX + "/{full_path:path}")
    def demo_disabled(full_path: str = "") -> Any:
        # 没开 DEMO_ENABLED 时明确 404，别让主站的 SPA 把 /demo 当成普通路径吞掉。
        return JSONResponse({"detail": "demo 未启用"}, status_code=404)


if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str) -> Any:
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        candidate = _static_file(full_path, _STATIC_ROOT)
        if candidate is not None:
            return FileResponse(candidate)
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(index)
        return JSONResponse({"detail": "前端还没构建，先 npm run build"}, status_code=404)
