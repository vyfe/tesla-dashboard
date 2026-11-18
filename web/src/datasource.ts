import type {
  Battery,
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
} from "./types";

/**
 * 看板的全部数据入口。
 *
 * 生产环境走 HTTP（真实 TeslaMate 库），demo 环境走本地 mock——
 * 上层页面只认这个接口，不关心数据从哪来，所以换数据源不需要改任何页面。
 */
export interface DataSource {
  meta(): Promise<Meta>;
  status(car?: number): Promise<VehicleStatus>;
  timeline(car?: number, days?: number): Promise<TimelineData>;
  overview(car?: number): Promise<Overview>;
  drives(params: {
    car?: number;
    limit?: number;
    offset?: number;
    date_from?: string;
  }): Promise<DrivesPage>;
  drive(id: number, car?: number): Promise<DriveDetail>;
  battery(car?: number): Promise<Battery>;
  charges(params: { car?: number; limit?: number; offset?: number }): Promise<ChargesPage>;
  /** 收藏点：圈定范围 + 充电定价 */
  geofences(): Promise<GeofencesResponse>;
  createGeofence(values: Partial<Geofence>): Promise<{ geofence: Geofence }>;
  updateGeofence(id: number, values: Partial<Geofence>): Promise<{ geofence: Geofence }>;
  deleteGeofence(id: number): Promise<{ ok: boolean }>;
  /** 按当前定价重算历史费用 */
  recalculateGeofence(
    id: number,
    options: { link_history?: boolean; force?: boolean },
  ): Promise<{ linked: number; updated: number; still_unpriced: number }>;
  /** 显示设置：单位、续航口径、主题等 */
  settings(): Promise<SettingsResponse>;
  /** 保存显示设置（写回 TeslaMate 的 settings 表） */
  saveSettings(settings: Settings): Promise<{ settings: Settings; writable: boolean }>;
}
