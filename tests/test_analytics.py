"""电池估算逻辑的单元测试（纯函数，不连库）。

    python3 -m unittest discover -s tests -t .
"""

from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import analytics  # noqa: E402


def charge(**overrides) -> dict:
    base = {
        "start_date": datetime(2026, 1, 1, 22, 0),
        "end_date": datetime(2026, 1, 2, 4, 0),
        "charge_energy_added": 42.0,
        "start_battery_level": 20,
        "end_battery_level": 80,
        "duration_min": 360,
        "end_rated_range_km": 400.0,
    }
    base.update(overrides)
    return base


class CapacityTest(unittest.TestCase):
    def test_basic_estimate(self) -> None:
        samples = analytics.estimate_capacity([charge()])
        self.assertEqual(len(samples), 1)
        # 42 kWh / 60% => 70 kWh
        self.assertAlmostEqual(samples[0].kwh, 70.0)

    def test_small_soc_delta_is_ignored(self) -> None:
        self.assertEqual(analytics.estimate_capacity([charge(end_battery_level=30)]), [])

    def test_short_session_is_ignored(self) -> None:
        self.assertEqual(analytics.estimate_capacity([charge(duration_min=5)]), [])

    def test_absurd_capacity_is_dropped(self) -> None:
        self.assertEqual(
            analytics.estimate_capacity([charge(charge_energy_added=300)]), []
        )

    def test_missing_fields_are_skipped(self) -> None:
        self.assertEqual(analytics.estimate_capacity([charge(charge_energy_added=None)]), [])
        self.assertEqual(analytics.estimate_capacity([charge(start_battery_level=None)]), [])

    def test_fast_charge_flag(self) -> None:
        slow = analytics.estimate_capacity([charge()])[0]
        fast = analytics.estimate_capacity([charge(duration_min=30)])[0]
        self.assertFalse(slow.is_fast)
        self.assertTrue(fast.is_fast)

    def test_sorted_by_time(self) -> None:
        later = charge(start_date=datetime(2026, 3, 1, 22, 0))
        earlier = charge(start_date=datetime(2026, 1, 1, 22, 0))
        samples = analytics.estimate_capacity([later, earlier])
        self.assertLess(samples[0].when, samples[1].when)


class RangeTest(unittest.TestCase):
    def test_normalised_to_full(self) -> None:
        samples = analytics.estimate_range([charge(end_rated_range_km=400, end_battery_level=80)])
        self.assertAlmostEqual(samples[0].km, 500.0)

    def test_low_soc_is_ignored(self) -> None:
        self.assertEqual(
            analytics.estimate_range([charge(end_rated_range_km=400, end_battery_level=30)]), []
        )

    def test_out_of_range_dropped(self) -> None:
        self.assertEqual(
            analytics.estimate_range([charge(end_rated_range_km=950, end_battery_level=100)]), []
        )


class AggregateTest(unittest.TestCase):
    def test_monthly_median(self) -> None:
        points = [
            (datetime(2026, 1, 3), 70.0),
            (datetime(2026, 1, 9), 72.0),
            (datetime(2026, 2, 2), 69.0),
        ]
        series = analytics.monthly_median(points)
        self.assertEqual([row["month"] for row in series], ["2026-01", "2026-02"])
        self.assertAlmostEqual(series[0]["value"], 71.0)
        self.assertEqual(series[0]["n"], 2)

    def test_health_uses_recent_median(self) -> None:
        samples = analytics.estimate_capacity(
            [charge() for _ in range(12)]
        )
        result = analytics.health(samples, nominal_kwh=75.6)
        self.assertAlmostEqual(result["kwh"], 70.0)
        self.assertAlmostEqual(result["pct"], 92.6)

    def test_health_without_samples(self) -> None:
        self.assertEqual(analytics.health([], 75.6), {"pct": None, "kwh": None, "samples": 0})

    def test_histogram_buckets(self) -> None:
        rows = [{"start_battery_level": 5}, {"start_battery_level": 25}, {"start_battery_level": 100}]
        histogram = analytics.soc_histogram(rows)
        self.assertEqual(len(histogram), 10)
        self.assertEqual(histogram[0]["n"], 1)
        self.assertEqual(histogram[2]["n"], 1)
        self.assertEqual(sum(bucket["n"] for bucket in histogram), 3)


if __name__ == "__main__":
    unittest.main()
