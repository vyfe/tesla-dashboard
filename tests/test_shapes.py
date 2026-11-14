"""接口输出形状的单元测试：单程电耗、充电效率（纯函数，不连库）。"""

from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import main  # noqa: E402


def drive_row(**overrides) -> dict:
    base = {
        "id": 1,
        "start_date": datetime(2026, 11, 13, 10, 0),
        "end_date": datetime(2026, 11, 13, 10, 30),
        "distance": 20.0,
        "duration_min": 30,
        "speed_max": 80,
        "start_rated_range_km": 400.0,
        "end_rated_range_km": 380.0,
        "outside_temp_avg": 12.0,
        "ascent": 10,
        "descent": 8,
        "start_geofence": "家",
        "end_geofence": "公司",
    }
    base.update(overrides)
    return base


def charge_row(**overrides) -> dict:
    base = {
        "id": 1,
        "start_date": datetime(2026, 11, 12, 22, 0),
        "end_date": datetime(2026, 11, 13, 4, 0),
        "duration_min": 360,
        "charge_energy_added": 40.0,
        "charge_energy_used": 44.0,
        "start_battery_level": 20,
        "end_battery_level": 80,
        "cost": 20.0,
        "address": "家, 朝阳区",
    }
    base.update(overrides)
    return base


class DriveShapeTest(unittest.TestCase):
    def test_consumption_is_per_100km(self) -> None:
        shaped = main._shape_drive(drive_row(), kwh_per_km=0.14)
        # (400 - 380) * 0.14 = 2.8 kWh / 20 km * 100 = 14.0
        self.assertAlmostEqual(shaped["energy_kwh"], 2.8)
        self.assertAlmostEqual(shaped["consumption"], 14.0)

    def test_consumption_is_none_without_energy(self) -> None:
        shaped = main._shape_drive(drive_row(), kwh_per_km=None)
        self.assertIsNone(shaped["consumption"])

    def test_zero_distance_does_not_divide_by_zero(self) -> None:
        shaped = main._shape_drive(drive_row(distance=0), kwh_per_km=0.14)
        self.assertIsNone(shaped["consumption"])
        self.assertIsNone(shaped["avg_speed"])


class ChargeShapeTest(unittest.TestCase):
    def test_efficiency_is_added_over_used(self) -> None:
        shaped = main._shape_charge(charge_row())
        self.assertAlmostEqual(shaped["efficiency"], 90.9)

    def test_missing_used_energy_yields_none(self) -> None:
        shaped = main._shape_charge(charge_row(charge_energy_used=None))
        self.assertIsNone(shaped["used_kwh"])
        self.assertIsNone(shaped["efficiency"])

    def test_fast_flag_uses_average_power(self) -> None:
        self.assertFalse(main._shape_charge(charge_row())["is_fast"])
        self.assertTrue(main._shape_charge(charge_row(duration_min=30))["is_fast"])


if __name__ == "__main__":
    unittest.main()
