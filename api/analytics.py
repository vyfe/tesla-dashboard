"""电池相关的估算逻辑（纯函数，方便单测）。

TeslaMate 不存电池容量，只能从充电过程反推：

    可用容量 ≈ 充入电量 / (结束 SOC - 开始 SOC) × 100

这玩意噪声很大，所以：
* 只取 SOC 跨度 ≥ 15% 且时长 ≥ 10 分钟的充电段；
* 直流快充发热会让充入电量偏大，单独标注但不剔除；
* 对外只给滚动中位数，不暴露单点。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from statistics import median

MIN_SOC_DELTA = 15
MIN_DURATION_MIN = 10
MIN_ENERGY_KWH = 3.0
SANITY_KWH = (30.0, 120.0)


@dataclass(frozen=True)
class CapacitySample:
    when: datetime
    kwh: float
    delta_soc: int
    is_fast: bool


@dataclass(frozen=True)
class RangeSample:
    when: datetime
    km: float


def estimate_capacity(
    rows: list[dict],
    *,
    min_delta: int = MIN_SOC_DELTA,
    min_duration: int = MIN_DURATION_MIN,
) -> list[CapacitySample]:
    out: list[CapacitySample] = []
    for row in rows:
        added = _float(row.get("charge_energy_added"))
        start = row.get("start_battery_level")
        end = row.get("end_battery_level")
        duration = row.get("duration_min") or 0
        when = row.get("start_date")
        if added is None or start is None or end is None or when is None:
            continue
        delta = end - start
        if delta < min_delta or added < MIN_ENERGY_KWH or duration < min_duration:
            continue
        kwh = round(added / delta * 100, 2)
        if not (SANITY_KWH[0] <= kwh <= SANITY_KWH[1]):
            continue
        hours = max(duration / 60.0, 1e-6)
        out.append(
            CapacitySample(
                when=when,
                kwh=kwh,
                delta_soc=delta,
                is_fast=(added / hours) > 15.0,
            )
        )
    return sorted(out, key=lambda s: s.when)


def estimate_range(rows: list[dict], *, min_end_soc: int = 50) -> list[RangeSample]:
    out: list[RangeSample] = []
    for row in rows:
        km = _float(row.get("end_rated_range_km"))
        end = row.get("end_battery_level")
        when = row.get("end_date") or row.get("start_date")
        if km is None or end is None or when is None or end < min_end_soc:
            continue
        full = km / (end / 100.0)
        if 200 <= full <= 900:
            out.append(RangeSample(when=when, km=round(full, 1)))
    return sorted(out, key=lambda s: s.when)


def monthly_median(points: list[tuple[datetime, float]]) -> list[dict]:
    buckets: dict[str, list[float]] = {}
    for when, value in points:
        buckets.setdefault(when.strftime("%Y-%m"), []).append(value)
    return [
        {"month": month, "value": round(median(values), 2), "n": len(values)}
        for month, values in sorted(buckets.items())
    ]


def soc_histogram(rows: list[dict]) -> list[dict]:
    buckets = [{"bucket": f"{i}-{i + 10}", "n": 0} for i in range(0, 100, 10)]
    for row in rows:
        start = row.get("start_battery_level")
        if start is None:
            continue
        index = min(int(start // 10), 9)
        buckets[index]["n"] += 1
    return buckets


def health(capacity: list[CapacitySample], nominal_kwh: float) -> dict:
    if not capacity:
        return {"pct": None, "kwh": None, "samples": 0}
    recent = capacity[-10:]
    kwh = round(median([s.kwh for s in recent]), 2)
    return {
        "pct": round(kwh / nominal_kwh * 100, 1) if nominal_kwh else None,
        "kwh": kwh,
        "samples": len(capacity),
    }


def _float(value) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
