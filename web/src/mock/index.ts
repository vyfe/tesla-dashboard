/**
 * demo 数据源。
 *
 * 关键约束：这里**只**读本地生成的数据，一个网络请求都不发。
 * 所以对外分享的 demo 页面不可能碰到真实数据库，也不存在「mock 失败就回落真实 API」的风险。
 */

import type { DataSource } from "../datasource";
import type {
  ChargesPage,
  DrivesPage,
  DriveDetail,
  Geofence,
  GeofencesResponse,
  Meta,
  Overview,
  Settings,
  SettingsResponse,
  TimelineData,
  VehicleStatus,
} from "../types";
import {
  buildDemoDataset,
  demoNow,
  deriveBattery,
  deriveChargesPage,
  deriveOverview,
  deriveStatus,
  deriveTimeline,
  type CarDataset,
} from "./generator";

/** demo 的收藏点：只存在内存里，改了不影响任何真实数据。 */
let mockGeofences: Geofence[] = [
  {
    id: 1,
    name: "家",
    lat: 30.281,
    lng: 120.162,
    radius: 120,
    cost_per_unit: 0.62,
    session_fee: null,
    billing_type: "per_kwh",
    charges: 18,
    priced_charges: 18,
    unpriced_charges: 0,
    energy_added: 412.6,
    energy_used: 441.2,
    total_cost: 273.5,
    avg_cost: 15.19,
    total_minutes: 1980,
    last_charge_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 2,
    name: "公司",
    lat: 30.183,
    lng: 120.245,
    radius: 150,
    cost_per_unit: 1.2,
    session_fee: 5,
    billing_type: "per_kwh",
    charges: 9,
    priced_charges: 7,
    unpriced_charges: 2,
    energy_added: 186.4,
    energy_used: 199.1,
    total_cost: 156.9,
    avg_cost: 22.41,
    total_minutes: 1240,
    last_charge_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

/** demo 的显示设置：只存在内存里，改了不影响任何真实数据。 */
let mockSettings: Settings = {
  unit_of_length: "km",
  unit_of_temperature: "C",
  preferred_range: "rated",
  unit_of_pressure: "bar",
  language: "zh_Hans",
  theme_mode: "system",
  base_url: "",
  grafana_url: "",
};

const MOCK_LANGUAGES = [
  { code: "zh_Hans", label: "简体中文" },
  { code: "en", label: "English" },
];

/** 模拟一点网络延迟，让加载态和真实环境一致。 */
function respond<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 90));
}

function pick(car?: number): { target: CarDataset; now: Date } {
  const now = demoNow();
  const dataset = buildDemoDataset(now);
  const cars = [...dataset.cars.values()];
  const target = cars.find((item) => item.car.id === car) ?? cars[0];
  return { target, now };
}

export const mockApi: DataSource = {
  meta(): Promise<Meta> {
    const now = demoNow();
    return respond(buildDemoDataset(now).meta);
  },

  status(car?: number): Promise<VehicleStatus> {
    const { target, now } = pick(car);
    return respond(deriveStatus(target, now));
  },

  timeline(car?: number, days = 7): Promise<TimelineData> {
    const { target, now } = pick(car);
    return respond(deriveTimeline(target, days, now));
  },

  overview(car?: number): Promise<Overview> {
    const { target, now } = pick(car);
    return respond(deriveOverview(target, now));
  },

  drives({ car, limit = 25, offset = 0, date_from }): Promise<DrivesPage> {
    const { target } = pick(car);
    const since = date_from ? new Date(`${date_from}T00:00:00`).getTime() : null;
    const matched = since
      ? target.drives.filter((drive) => new Date(drive.started_at).getTime() >= since)
      : target.drives;
    const items = matched.slice(offset, offset + limit);
    return respond({
      total: matched.length,
      items,
      kwh_per_km: deriveBattery(target, demoNow()).kwh_per_km,
    });
  },

  drive(id: number, car?: number): Promise<DriveDetail> {
    const { target } = pick(car);
    const drive = target.drives.find((item) => item.id === id);
    if (!drive) {
      return Promise.reject(new Error("行程不存在"));
    }
    return respond({ drive, series: target.series.get(id) ?? [] });
  },

  battery(car?: number) {
    const { target, now } = pick(car);
    return respond(deriveBattery(target, now));
  },

  charges({ car, limit = 30, offset = 0 }): Promise<ChargesPage> {
    const { target } = pick(car);
    return respond(deriveChargesPage(target, limit, offset));
  },

  geofences(): Promise<GeofencesResponse> {
    return respond({ geofences: mockGeofences, writable: true });
  },

  createGeofence(values: Partial<Geofence>): Promise<{ geofence: Geofence }> {
    const created: Geofence = {
      id: Math.max(0, ...mockGeofences.map((g) => g.id)) + 1,
      name: values.name ?? "新收藏点",
      lat: values.lat ?? null,
      lng: values.lng ?? null,
      radius: values.radius ?? 100,
      cost_per_unit: values.cost_per_unit ?? null,
      session_fee: values.session_fee ?? null,
      billing_type: values.billing_type ?? "per_kwh",
      charges: 0,
      priced_charges: 0,
      unpriced_charges: 0,
      energy_added: 0,
      energy_used: 0,
      total_cost: 0,
      avg_cost: null,
      total_minutes: 0,
      last_charge_at: null,
      updated_at: new Date().toISOString(),
    };
    mockGeofences = [...mockGeofences, created];
    return respond({ geofence: created });
  },

  updateGeofence(id: number, values: Partial<Geofence>): Promise<{ geofence: Geofence }> {
    let updated: Geofence | null = null;
    mockGeofences = mockGeofences.map((g) => {
      if (g.id !== id) return g;
      updated = { ...g, ...values, id: g.id, updated_at: new Date().toISOString() };
      return updated;
    });
    return respond({ geofence: updated ?? mockGeofences[0] });
  },

  deleteGeofence(id: number): Promise<{ ok: boolean }> {
    mockGeofences = mockGeofences.filter((g) => g.id !== id);
    return respond({ ok: true });
  },

  recalculateGeofence(
    id: number,
  ): Promise<{ linked: number; updated: number; still_unpriced: number }> {
    mockGeofences = mockGeofences.map((g) =>
      g.id === id
        ? { ...g, unpriced_charges: 0, priced_charges: g.charges }
        : g,
    );
    return respond({ linked: 3, updated: 5, still_unpriced: 0 });
  },

  settings(): Promise<SettingsResponse> {
    return respond({ settings: mockSettings, writable: true, languages: MOCK_LANGUAGES });
  },

  saveSettings(settings: Settings): Promise<{ settings: Settings; writable: boolean }> {
    mockSettings = { ...mockSettings, ...settings };
    return respond({ settings: mockSettings, writable: true });
  },
};
