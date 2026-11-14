import type {
  Battery,
  ChargesPage,
  DrivesPage,
  DriveDetail,
  Meta,
  Overview,
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
}
