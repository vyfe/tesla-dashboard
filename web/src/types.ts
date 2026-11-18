export interface Car {
  id: number;
  name: string;
  model?: string | null;
  trim?: string | null;
  vin?: string | null;
}

/** 显示设置：与 TeslaMate 的 settings 表同源，改一处两边都变。 */
export interface Settings {
  unit_of_length: "km" | "mi";
  unit_of_temperature: "C" | "F";
  preferred_range: "rated" | "ideal";
  unit_of_pressure: "bar" | "psi";
  language: string;
  theme_mode: "system" | "light" | "dark";
  base_url: string;
  grafana_url: string;
}

export interface SettingsResponse {
  settings: Settings;
  writable: boolean;
  languages: Array<{ code: string; label: string }>;
}

export interface Meta {
  cars: Car[];
  nominal_kwh: number;
  range: { first_drive?: string | null; last_drive?: string | null };
  /** demo 模式下各套场景的说明，用来在界面上标注当前看的是哪种用法。 */
  demo_scenarios?: { id: number; name: string; tagline: string }[];
  /** 当前显示设置 */
  settings?: Settings;
  /** 看板是否具备写设置的能力 */
  settings_writable?: boolean;
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
  /** 充电点坐标（WGS-84），悬停出小地图用 */
  lat: number | null;
  lng: number | null;
  /** 命中的收藏点（圈定范围内） */
  geofence_id: number | null;
  geofence_name: string | null;
}

/** 收藏点（TeslaMate 的 geofences）：圈定范围 + 充电定价。 */
export interface Geofence {
  id: number;
  name: string;
  lat: number | null;
  lng: number | null;
  /** 圈定半径（米） */
  radius: number;
  /** 单价：per_kwh 是每度电，per_minute 是每分钟 */
  cost_per_unit: number | null;
  /** 每次充电的固定服务费 */
  session_fee: number | null;
  billing_type: "per_kwh" | "per_minute";
  /** 关联到的充电次数 */
  charges: number;
  /** 其中已算出费用的次数 */
  priced_charges: number;
  /** 还没算价的次数 */
  unpriced_charges: number;
  energy_added: number | null;
  energy_used: number | null;
  /** 累计费用 */
  total_cost: number | null;
  /** 单次均价 */
  avg_cost: number | null;
  total_minutes: number | null;
  last_charge_at: string | null;
  updated_at: string | null;
}

export interface GeofencesResponse {
  geofences: Geofence[];
  writable: boolean;
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

/** 一次停留：车静止不动的那段时间。 */
export interface TimelineStop extends TimelineInterval {
  minutes: number;
  lat: number | null;
  lng: number | null;
  /** 地点名（围栏名或逆地理编码地址） */
  name: string | null;
  /** 名字来源：geofence（自己起的围栏名）/ address（逆地理编码） */
  source: string | null;
}

/** 一次充电：比 TimelineInterval 多带充电点坐标。 */
export interface TimelineCharge extends TimelineInterval {
  kwh: number | null;
  lat: number | null;
  lng: number | null;
  name: string | null;
}

export interface TimelineData {
  days: number;
  since: string;
  until: string;
  drives: (TimelineInterval & { distance_km: number | null; from: string; to: string })[];
  charges: TimelineCharge[];
  stops: TimelineStop[];
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
