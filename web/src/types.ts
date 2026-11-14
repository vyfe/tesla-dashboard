export interface Car {
  id: number;
  name: string;
  model?: string | null;
  trim?: string | null;
  vin?: string | null;
}

export interface Meta {
  cars: Car[];
  nominal_kwh: number;
  range: { first_drive?: string | null; last_drive?: string | null };
  /** demo 模式下各套场景的说明，用来在界面上标注当前看的是哪种用法。 */
  demo_scenarios?: { id: number; name: string; tagline: string }[];
}

export interface Drive {
  id: number;
  started_at: string;
  ended_at: string | null;
  distance_km: number | null;
  duration_min: number;
  avg_speed: number | null;
  max_speed: number | null;
  energy_kwh: number | null;
  consumption: number | null;
  from: string;
  to: string;
  from_raw: string | null;
  to_raw: string | null;
  outside_temp: number | null;
  ascent: number | null;
  descent: number | null;
}

export interface SeriesPoint {
  t: string;
  speed: number | null;
  power: number | null;
  soc: number | null;
  elevation: number | null;
  odometer: number | null;
  /** WGS-84 原始坐标，底图需要 GCJ-02 时由前端换算 */
  lat: number | null;
  lng: number | null;
}

export interface DriveDetail {
  drive: Drive;
  series: SeriesPoint[];
}

export interface Charge {
  id: number;
  started_at: string;
  ended_at: string | null;
  kwh: number | null;
  used_kwh: number | null;
  efficiency: number | null;
  duration_min: number;
  power: number | null;
  is_fast: boolean;
  start_soc: number | null;
  end_soc: number | null;
  cost: number | null;
  address: string;
}

export interface VehicleStatus {
  car_id: number;
  available: boolean;
  soc: number | null;
  usable_soc: number | null;
  range_km: number | null;
  odometer_km: number | null;
  updated_at: string | null;
  age_min: number | null;
  charging: boolean;
}

export interface Ledger {
  charged_kwh: number;
  grid_kwh: number | null;
  consumed_kwh: number | null;
  cost: number;
  cost_per_kwh: number | null;
  efficiency_pct: number | null;
  sessions: number;
}

export interface TimelineInterval {
  start: string;
  end: string | null;
}

export interface TimelineData {
  days: number;
  since: string;
  until: string;
  drives: (TimelineInterval & { distance_km: number | null })[];
  charges: (TimelineInterval & { kwh: number | null })[];
  states: (TimelineInterval & { state: string })[];
  states_available: boolean;
}

export interface Battery {
  nominal_kwh: number;
  health_pct: number | null;
  capacity_kwh: number | null;
  capacity_samples: number;
  range_km: number | null;
  range_samples: number;
  fast_share: number | null;
  capacity_series: { month: string; kwh: number; n: number }[];
  range_series: { month: string; value: number; n: number }[];
  soc_histogram: { bucket: string; n: number }[];
  kwh_per_km: number | null;
}

export interface Overview {
  car: Car;
  kpis: {
    month_km: number;
    prev_month_km: number;
    month_drives: number;
    avg_trip_km: number | null;
    consumption: number | null;
    battery_health: number | null;
    capacity_kwh: number | null;
    nominal_kwh: number;
  };
  ledger: Ledger;
  daily: { date: string; km: number }[];
  recent_drives: Drive[];
  recent_charges: Charge[];
  battery: Battery;
}

export interface DrivesPage {
  total: number;
  items: Drive[];
  kwh_per_km: number | null;
}

export interface ChargesPage {
  total: number;
  items: Charge[];
  page_kwh: number;
  total_kwh: number;
  total_used_kwh: number | null;
  total_cost: number;
  efficiency_pct: number | null;
  avg_kwh: number | null;
  fast_share: number | null;
  monthly: { month: string; kwh: number; n: number; cost: number }[];
}
