"""接口输出形状的单元测试：单程电耗、充电效率（纯函数，不连库）。"""

from __future__ import annotations

import sys
import unittest
from datetime import datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import main, queries  # noqa: E402


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
        "latitude": Decimal("39.996200"),
        "longitude": Decimal("116.480800"),
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

    def test_charge_carries_place_coordinates(self) -> None:
        shaped = main._shape_charge(charge_row())
        self.assertAlmostEqual(shaped["lat"], 39.9962)
        self.assertAlmostEqual(shaped["lng"], 116.4808)

    def test_charge_without_coordinates_is_none(self) -> None:
        shaped = main._shape_charge(charge_row(latitude=None, longitude=None))
        self.assertIsNone(shaped["lat"])
        self.assertIsNone(shaped["lng"])


class GeofenceValidationTest(unittest.TestCase):
    """收藏点字段校验：纯函数，不连库。"""

    def test_accepts_lat_lng_alias(self) -> None:
        params = queries._validate_geofence(
            {
                "name": "家",
                "lat": 39.91788,
                "lng": 116.27738,
                "radius": 100,
                "billing_type": "per_kwh",
                "cost_per_unit": 0.6,
            }
        )
        self.assertAlmostEqual(params["latitude"], 39.91788)
        self.assertAlmostEqual(params["longitude"], 116.27738)
        self.assertEqual(params["radius"], 100)
        self.assertEqual(params["billing_type"], "per_kwh")

    def test_accepts_database_column_names(self) -> None:
        params = queries._validate_geofence(
            {
                "name": "公司",
                "latitude": 39.78,
                "longitude": 116.55,
                "radius": 200,
                "billing_type": "per_minute",
                "cost_per_unit": 0.05,
                "session_fee": 5,
            }
        )
        self.assertAlmostEqual(params["latitude"], 39.78)
        self.assertEqual(params["billing_type"], "per_minute")

    def test_rejects_bad_values(self) -> None:
        base = {
            "name": "x",
            "lat": 39.9,
            "lng": 116.2,
            "radius": 100,
            "billing_type": "per_kwh",
            "cost_per_unit": 0.6,
        }
        with self.assertRaises(ValueError):
            queries._validate_geofence({**base, "name": "  "})
        with self.assertRaises(ValueError):
            queries._validate_geofence({**base, "lat": 999})
        with self.assertRaises(ValueError):
            queries._validate_geofence({**base, "radius": 0})
        with self.assertRaises(ValueError):
            queries._validate_geofence({**base, "billing_type": "per_second"})
        with self.assertRaises(ValueError):
            queries._validate_geofence({**base, "cost_per_unit": -1})
        with self.assertRaises(ValueError):
            queries._validate_geofence({**base, "cost_per_unit": None, "session_fee": None})


if __name__ == "__main__":
    unittest.main()
