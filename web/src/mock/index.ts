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
  Meta,
  Overview,
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
};
