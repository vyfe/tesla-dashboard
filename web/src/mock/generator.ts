/**
 * demo 数据生成器。
 *
 * 目标：让每个页面都有一整套自洽的假数据——
 * 里程、能耗、充电量、电池容量趋势、行程曲线互相能对得上，
 * 打开就是一张「真实看板」，而不是几组随手编的数字。
 *
 * 全部数据由固定 seed 的伪随机生成，重复打开结果一致。
 */

import type {
  Battery,
  Car,
  Charge,
  ChargesPage,
  Drive,
  Meta,
  Overview,
  SeriesPoint,
  TimelineData,
  VehicleStatus,
} from "../types";
import { Rng } from "./random";
import { SCENARIOS, type Place, type Scenario } from "./scenarios";

const DAY_MS = 86_400_000;
const MONTH_DAYS = 30.44;
/** 电芯质量约 2 吨，功率模型里用它把加速度换算成 kW。 */
const CURB_WEIGHT_KG = 2000;

export interface CarDataset {
  car: Car;
  scenario: Scenario;
  /** 全部行程，新的在前 */
  drives: Drive[];
  /** 行程 id → 采样点（速度 / 功率 / 电量 / 海拔 / 里程） */
  series: Map<number, SeriesPoint[]>;
  /** 全部充电，新的在前 */
  charges: Charge[];
  /** 当前累计总里程 km */
  odometer: number;
  /** 当前剩余电量 %——由按天仿真得出，和行程、充电记录始终一致 */
  currentSoc: number;
}

export interface DemoDataset {
  meta: Meta;
  cars: Map<number, CarDataset>;
}

function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function monthKey(date: Date): string {
  return localDateKey(date).slice(0, 7);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 当天气温：季节曲线 + 场景基准 + 噪声。 */
function temperatureAt(scenario: Scenario, date: Date, rng: Rng): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / DAY_MS);
  // 1 月最冷、7 月最热
  const seasonal = Math.cos(((dayOfYear - 200) / 365) * 2 * Math.PI);
  const [low, high] = scenario.tempRange;
  const mid = (low + high) / 2;
  const half = (high - low) / 2;
  return mid + seasonal * half * 0.4 + rng.normal(0, 1.8);
}

/** 低温掉电、空调耗电、跑高速更费电——能耗随温度和工况浮动。 */
function consumptionFactor(temp: number, profile: Profile): number {
  const tempFactor = temp < 5 ? 1 + (5 - temp) * 0.011 : 1 + Math.max(0, temp - 25) * 0.004;
  const profileFactor = profile === "highway" ? 1.13 : profile === "mixed" ? 1.05 : 1;
  return tempFactor * profileFactor;
}

type Profile = "city" | "mixed" | "highway";

interface RouteSpec {
  avgSpeed: number;
  profile: Profile;
}

/**
 * 路线类型只决定工况和均速，距离由起终点的地理距离推算——
 * 这样列表里的里程和地图上轨迹的长度永远对得上。
 */
function pickRoute(longChance: number, rng: Rng): RouteSpec {
  if (rng.chance(longChance)) {
    return { avgSpeed: round(rng.float(85, 115), 1), profile: "highway" };
  }
  if (rng.chance(0.2)) {
    return { avgSpeed: round(rng.float(45, 70), 1), profile: "mixed" };
  }
  return { avgSpeed: round(rng.float(22, 42), 1), profile: "city" };
}

/** 两点的球面距离（km）。 */
function geoDistanceKm(a: Place, b: Place): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** 从「家」这类地名展开成完整地址，让列表页看起来像真的。 */
function addressOf(city: string, place: string, rng: Rng): string {
  const streets = ["文景路", "临江大道", "科创三路", "望江西街", "海棠巷", "云栖大道", "银杏北路"];
  const street = rng.pick(streets);
  const number = rng.int(1, 240);
  return `${city}${place}附近${street}${number}号`;
}

/**
 * 生成一条行程的采样点。
 * 速度走「加速 → 匀速 → 减速 → 停车」剖面，功率按 P≈v³ 加上加速阻力估算，
 * 电量按能量消耗线性下降——这样曲线形状和数值互相自洽。
 * 坐标在起终点之间插值并加一点弯曲，落到地图上是一条像样的路线。
 */
function buildSeries(
  rng: Rng,
  drive: Drive,
  profile: Profile,
  startSoc: number,
  endSoc: number,
  odoStart: number,
  from: Place,
  to: Place,
): SeriesPoint[] {
  const durationMin = Math.max(1, drive.duration_min);
  const points = Math.max(16, Math.min(150, Math.round(durationMin * 1.5)));
  const dtHours = durationMin / 60 / points;
  const vmax = Math.max(22, (drive.avg_speed ?? 40) * 1.32);

  const latSpan = to.lat - from.lat;
  const lngSpan = to.lng - from.lng;
  const span = Math.hypot(latSpan, lngSpan);
  // 整段路线往一侧鼓一点，看起来像沿着一条路走而不是直线
  const bendDirection = rng.chance(0.5) ? 1 : -1;
  const jitter = Math.max(span * 0.004, 0.0004);

  const series: SeriesPoint[] = [];
  let elevation = rng.int(2, 60);
  let odometer = odoStart;
  let previousSpeed = 0;

  for (let index = 0; index < points; index += 1) {
    const t = index / (points - 1);
    let speed: number;
    if (t < 0.1) speed = (t / 0.1) * vmax;
    else if (t < 0.84) speed = vmax * (0.94 + 0.06 * Math.sin(t * 21));
    else if (t < 0.94) speed = vmax * (1 - (t - 0.84) / 0.1) * 0.9;
    else speed = 0;

    // 匀速阻力 + 风阻（∝v³）+ 加速阻力
    const acceleration = (speed - previousSpeed) / 3.6 / dtHours; // m/s²
    const drag = 1.4 + (speed ** 3) / 42000;
    const inertia = (CURB_WEIGHT_KG * acceleration * speed) / 1000; // kW
    const power = round(drag + inertia, 2);

    elevation += rng.normal(profile === "highway" ? 1.4 : 0.25, 1.6);
    odometer += speed * dtHours;

    series.push({
      t: new Date(new Date(drive.started_at).getTime() + index * dtHours * 3_600_000).toISOString(),
      speed: round(speed, 1),
      power,
      soc: round(startSoc - (startSoc - endSoc) * t, 1),
      elevation: Math.round(elevation),
      odometer: round(odometer, 2),
      lat: round(from.lat + latSpan * t + Math.sin(t * Math.PI) * span * 0.09 * bendDirection * 0.55 + rng.normal(0, jitter), 6),
      lng: round(from.lng + lngSpan * t + Math.sin(t * Math.PI) * span * 0.09 * bendDirection * 0.83 + rng.normal(0, jitter), 6),
    });
    previousSpeed = speed;
  }

  return series;
}

function buildCar(scenario: Scenario, now: Date): CarDataset {
  const rng = new Rng(scenario.id * 7919 + 104729);
  const drives: Drive[] = [];
  const series = new Map<number, SeriesPoint[]>();
  const charges: Charge[] = [];

  const capacityNow = scenario.nominalKwh * scenario.healthNow;
  const totalDays = Math.round(scenario.months * MONTH_DAYS);

  // ------------------------------------------------- 按天推进：规划 → 补电 → 行程 → 再补电
  let driveId = 1;
  let chargeId = 1;
  let odometer = rng.int(8_000, 26_000);
  let soc = 100; // 起始满电
  const historyStart = new Date(now.getTime() - totalDays * DAY_MS);
  historyStart.setHours(0, 0, 0, 0);

  for (let dayOffset = 0; dayOffset <= totalDays; dayOffset += 1) {
    const day = new Date(historyStart.getTime() + dayOffset * DAY_MS);
    if (day.getTime() > now.getTime()) break;

    const weekend = day.getDay() === 0 || day.getDay() === 6;
    let count = Math.round(
      rng.normal(scenario.drivesPerDay + (weekend ? scenario.weekendExtra : 0), 0.7),
    );
    count = Math.max(0, Math.min(count, weekend ? 4 : 3));

    // 先规划今天的路线：长途一天最多一趟
    const plans: RouteSpec[] = [];
    let longUsed = false;
    for (let index = 0; index < count; index += 1) {
      const route = pickRoute(weekend && !longUsed ? scenario.longChance : 0, rng);
      if (route.profile === "highway") longUsed = true;
      plans.push(route);
    }
    const hasLong = plans.some((route) => route.profile === "highway");

    /** 记一次充电，并返回充完后的电量 */
    const addCharge = (
      fast: boolean,
      hour: number,
    ): number => {
      const startSoc = Math.round(soc);
      const endSoc = fast ? rng.int(76, 95) : rng.int(88, 100);
      const kwh = round(((endSoc - startSoc) / 100) * capacityNow, 2);
      const efficiency = round(rng.float(0.87, 0.94), 3);
      const usedKwh = round(kwh / efficiency, 2);
      // 快充平均 60~110 kW，慢充 7 kW 上下
      const avgPower = fast ? rng.float(62, 112) : rng.float(6.5, 7.6);
      const durationMin = Math.max(12, Math.round((kwh / avgPower) * 60));

      const startedAt = new Date(day);
      startedAt.setHours(hour, rng.int(0, 59), 0, 0);
      const endedAt = new Date(startedAt.getTime() + durationMin * 60_000);
      const place = fast ? `${rng.pick(scenario.farPlaces).name}服务区` : "家";
      const placeCoord = [...scenario.places, ...scenario.farPlaces].find(
        (candidate) => place.startsWith(candidate.name),
      );

      charges.push({
        id: chargeId,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        kwh,
        used_kwh: usedKwh,
        efficiency: round(efficiency * 100, 1),
        duration_min: durationMin,
        power: round(avgPower, 1),
        is_fast: fast,
        start_soc: startSoc,
        end_soc: endSoc,
        cost: round(kwh * scenario.pricePerKwh * rng.float(0.94, 1.08), 2),
        address: addressOf(scenario.city, place, rng),
        lat: placeCoord?.lat ?? null,
        lng: placeCoord?.lng ?? null,
      });
      chargeId += 1;
      soc = endSoc;
      return endSoc;
    };

    // 长途前先补电，不然跑不到目的地
    if (hasLong && soc < 85) addCharge(true, 7);

    for (const route of plans) {
      // 长途一律从「家」开到远郊；日常出行在本地地点池里随机配对
      const home = scenario.places[0];
      const from = route.profile === "highway" ? home : rng.pick(scenario.places);
      let to =
        route.profile === "highway" ? rng.pick(scenario.farPlaces) : rng.pick(scenario.places);
      if (to === from) {
        to = scenario.places[(scenario.places.indexOf(from) + 1) % scenario.places.length];
      }

      const startHour = weekend
        ? rng.pick([9, 10, 13.5, 15, 16.5])
        : rng.pick([7.5, 8, 8.5, 17.5, 18, 18.5]);
      const startedAt = new Date(day);
      startedAt.setHours(Math.floor(startHour), Math.round((startHour % 1) * 60), 0, 0);
      if (startedAt.getTime() > now.getTime()) continue;

      // 道路里程 ≈ 直线距离 × 路网绕行系数
      const distanceKm = round(
        Math.max(3, geoDistanceKm(from, to) * 1.35 * rng.float(0.95, 1.12)),
        1,
      );
      // 1.18 的系数是红灯、进出城这些「时间不产生里程」的损耗
      const durationMin = Math.max(3, Math.round((distanceKm / route.avgSpeed) * 60 * 1.18));
      const endedAt = new Date(startedAt.getTime() + durationMin * 60_000);

      const temp = temperatureAt(scenario, startedAt, rng);
      const consumption = round(
        scenario.baseConsumption * consumptionFactor(temp, route.profile) * rng.float(0.93, 1.07),
        1,
      );
      const energyKwh = round((consumption / 100) * distanceKm, 2);

      const startSoc = Math.round(soc);
      const endSoc = round(Math.max(6, startSoc - (energyKwh / capacityNow) * 100), 0);

      const drive: Drive = {
        id: driveId,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        distance_km: distanceKm,
        duration_min: durationMin,
        avg_speed: route.avgSpeed,
        max_speed: round(route.avgSpeed * rng.float(1.3, 1.7), 0),
        energy_kwh: energyKwh,
        consumption,
        from: from.name,
        to: to.name,
        from_raw: addressOf(scenario.city, from.name, rng),
        to_raw: addressOf(scenario.city, to.name, rng),
        outside_temp: round(temp, 1),
        ascent: Math.round(rng.float(0, route.profile === "highway" ? 420 : 90)),
        descent: Math.round(rng.float(0, route.profile === "highway" ? 400 : 80)),
      };

      series.set(
        driveId,
        buildSeries(rng, drive, route.profile, startSoc, endSoc, odometer, from, to),
      );
      odometer += distanceKm;
      drives.push(drive);
      driveId += 1;
      soc = endSoc;
    }

    // 回家补电：电量还够就等明天
    if (soc < 78 && rng.chance(0.85)) {
      addCharge(soc < 22, soc < 22 ? 18 : 23);
    }
  }

  // 倒序：最近的在最前面，和后端查询的排序一致
  drives.sort((a, b) => b.started_at.localeCompare(a.started_at));
  charges.sort((a, b) => b.started_at.localeCompare(a.started_at));

  return {
    car: {
      id: scenario.id,
      name: scenario.name,
      model: scenario.model,
      trim: scenario.trim,
      vin: scenario.vin,
    },
    scenario,
    drives,
    series,
    charges,
    odometer: Math.round(odometer),
    currentSoc: Math.round(soc),
  };
}

/** 按本地月份把充电样本归类，取中位数——和后端 monthly_median 口径一致。 */
function monthlyMedians(
  rows: { month: string; value: number }[],
): { month: string; value: number; n: number }[] {
  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    const list = buckets.get(row.month) ?? [];
    list.push(row.value);
    buckets.set(row.month, list);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, values]) => ({ month, value: round(median(values), 2), n: values.length }));
}

export function deriveBattery(data: CarDataset, now: Date): Battery {
  const { scenario, charges } = data;
  const capacityNow = scenario.nominalKwh * scenario.healthNow;
  const kwhPerKm = scenario.baseConsumption / 100;

  // 容量随时间线性衰减到 healthNow，中间按月给一个带噪声的样本
  const capacitySamples = charges
    .filter((charge) => charge.end_soc !== null && charge.start_soc !== null)
    .map((charge) => {
      const when = new Date(charge.started_at);
      // age: 0 = 最早，1 = 现在。越久远健康度越接近 healthStart。
      const age = Math.max(
        0,
        Math.min(1, (now.getTime() - when.getTime()) / (scenario.months * MONTH_DAYS * DAY_MS)),
      );
      const health = scenario.healthStart + (scenario.healthNow - scenario.healthStart) * age;
      // 充电的 kwh 是按当前容量算的，除以 healthNow 才能还原成当时的容量
      const factor = health / scenario.healthNow;
      const delta = (charge.end_soc as number) - (charge.start_soc as number);
      const kwh = delta > 0 ? ((charge.kwh as number) / delta) * 100 : 0;
      return { month: monthKey(when), value: kwh * factor };
    });

  const rangeSamples = charges
    .filter((charge) => charge.end_soc !== null && charge.start_soc !== null)
    .map((charge) => {
      const when = new Date(charge.started_at);
      const age = Math.max(
        0,
        Math.min(1, (now.getTime() - when.getTime()) / (scenario.months * MONTH_DAYS * DAY_MS)),
      );
      const health = scenario.healthStart + (scenario.healthNow - scenario.healthStart) * age;
      const factor = health / scenario.healthNow;
      // 归一化到 100% SOC，再按结束电量做一点点折损——和后端口径一致
      const socFactor = 0.9 + (0.1 * (charge.end_soc as number)) / 100;
      const km = ((capacityNow * factor) / kwhPerKm) * socFactor;
      return { month: monthKey(when), value: km };
    });

  const capacitySeries = monthlyMedians(capacitySamples).map((item) => ({
    month: item.month,
    kwh: item.value,
    n: item.n,
  }));
  const rangeSeries = monthlyMedians(rangeSamples);

  const buckets = Array.from({ length: 10 }, (_, index) => ({
    bucket: `${index}-${index + 10}`,
    n: 0,
  }));
  for (const charge of charges) {
    const start = charge.start_soc;
    if (start === null) continue;
    buckets[Math.min(Math.floor(start / 10), 9)].n += 1;
  }

  const capacityKwh = round(capacityNow, 2);
  const rangeKm = Math.round(capacityKwh / kwhPerKm);
  const fastCount = charges.filter((charge) => charge.is_fast).length;

  return {
    nominal_kwh: scenario.nominalKwh,
    health_pct: round(scenario.healthNow * 100, 1),
    capacity_kwh: capacityKwh,
    capacity_samples: capacitySamples.length,
    range_km: rangeKm,
    range_samples: rangeSamples.length,
    fast_share: charges.length ? round((fastCount / charges.length) * 100, 1) : null,
    capacity_series: capacitySeries,
    range_series: rangeSeries,
    soc_histogram: buckets,
    kwh_per_km: round(capacityKwh / rangeKm, 4),
  };
}

/** 近 N 天的日里程，和后端 daily_distance 一样把没出行的日子补 0。 */
export function deriveDaily(data: CarDataset, days: number): { date: string; km: number }[] {
  const totals = new Map<string, number>();
  for (const drive of data.drives) {
    const key = localDateKey(new Date(drive.started_at));
    totals.set(key, (totals.get(key) ?? 0) + (drive.distance_km ?? 0));
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const result: { date: string; km: number }[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const day = new Date(today.getTime() - index * DAY_MS);
    const key = localDateKey(day);
    result.push({ date: key, km: round(totals.get(key) ?? 0, 1) });
  }
  return result;
}

/** 某个月窗口内的里程与行程数。monthsBack=0 表示本月。 */
function monthWindow(monthsBack: number, now: Date): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const end = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1);
  return { start, end };
}

export function deriveOverview(data: CarDataset, now: Date): Overview {
  const { scenario, drives, charges, car } = data;
  const battery = deriveBattery(data, now);
  const kwhPerKm = battery.kwh_per_km ?? scenario.baseConsumption / 100;

  const window = monthWindow(0, now);
  const prevWindow = monthWindow(1, now);
  const inWindow = (drive: Drive, range: { start: Date; end: Date }) => {
    const when = new Date(drive.started_at);
    return when >= range.start && when < range.end;
  };

  const monthDrives = drives.filter((drive) => inWindow(drive, window));
  const prevDrives = drives.filter((drive) => inWindow(drive, prevWindow));
  const monthKm = monthDrives.reduce((sum, drive) => sum + (drive.distance_km ?? 0), 0);
  const prevKm = prevDrives.reduce((sum, drive) => sum + (drive.distance_km ?? 0), 0);

  const monthCharges = charges.filter((charge) => {
    const when = new Date(charge.started_at);
    return when >= window.start && when < window.end;
  });
  const chargedKwh = monthCharges.reduce((sum, charge) => sum + (charge.kwh ?? 0), 0);
  const gridKwh = monthCharges.reduce((sum, charge) => sum + (charge.used_kwh ?? 0), 0);
  const cost = monthCharges.reduce((sum, charge) => sum + (charge.cost ?? 0), 0);

  return {
    car,
    kpis: {
      month_km: round(monthKm, 1),
      prev_month_km: round(prevKm, 1),
      month_drives: monthDrives.length,
      avg_trip_km: monthDrives.length ? round(monthKm / monthDrives.length, 1) : null,
      consumption: round(kwhPerKm * 100, 1),
      battery_health: battery.health_pct,
      capacity_kwh: battery.capacity_kwh,
      nominal_kwh: scenario.nominalKwh,
    },
    ledger: {
      charged_kwh: round(chargedKwh, 1),
      grid_kwh: gridKwh ? round(gridKwh, 1) : null,
      consumed_kwh: round(monthKm * kwhPerKm, 1),
      cost: round(cost, 2),
      cost_per_kwh: chargedKwh ? round(cost / chargedKwh, 2) : null,
      efficiency_pct: chargedKwh && gridKwh ? round((chargedKwh / gridKwh) * 100, 1) : null,
      sessions: monthCharges.length,
    },
    daily: deriveDaily(data, 45),
    recent_drives: drives.slice(0, 8),
    recent_charges: charges.slice(0, 5),
    battery,
  };
}

export function deriveChargesPage(data: CarDataset, limit: number, offset: number): ChargesPage {
  const { charges } = data;
  const items = charges.slice(offset, offset + limit);
  const totalKwh = charges.reduce((sum, charge) => sum + (charge.kwh ?? 0), 0);
  const totalUsedKwh = charges.reduce((sum, charge) => sum + (charge.used_kwh ?? 0), 0);
  const totalCost = charges.reduce((sum, charge) => sum + (charge.cost ?? 0), 0);
  const fastCount = charges.filter((charge) => charge.is_fast).length;

  const monthlyBuckets = new Map<string, { month: string; kwh: number; n: number; cost: number }>();
  for (const charge of charges) {
    const key = monthKey(new Date(charge.started_at));
    const bucket = monthlyBuckets.get(key) ?? { month: key, kwh: 0, n: 0, cost: 0 };
    bucket.kwh += charge.kwh ?? 0;
    bucket.cost += charge.cost ?? 0;
    bucket.n += 1;
    monthlyBuckets.set(key, bucket);
  }
  const monthly = [...monthlyBuckets.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12)
    .map((bucket) => ({
      month: bucket.month,
      kwh: round(bucket.kwh, 1),
      n: bucket.n,
      cost: round(bucket.cost, 2),
    }));

  return {
    total: charges.length,
    items,
    page_kwh: round(items.reduce((sum, charge) => sum + (charge.kwh ?? 0), 0), 1),
    total_kwh: round(totalKwh, 1),
    total_used_kwh: totalUsedKwh ? round(totalUsedKwh, 1) : null,
    total_cost: round(totalCost, 2),
    efficiency_pct: totalKwh && totalUsedKwh ? round((totalKwh / totalUsedKwh) * 100, 1) : null,
    avg_kwh: charges.length ? round(totalKwh / charges.length, 1) : null,
    fast_share: charges.length ? round((fastCount / charges.length) * 100, 1) : null,
    monthly,
  };
}

/**
 * 停留段：行程结束后车停在目的地若干分钟，充电过程也算一次长时间停留。
 * 坐标取行程终点的 place。
 */
function deriveStops(
  drives: CarDataset["drives"],
  charges: CarDataset["charges"],
  series: CarDataset["series"],
): TimelineData["stops"] {
  const stops: TimelineData["stops"] = [];
  for (const drive of drives) {
    if (!drive.ended_at) continue;
    // 轨迹的最后一个点就是目的地，停留地点取它的坐标
    const last = series.get(drive.id)?.at(-1);
    if (!last || last.lat == null || last.lng == null) continue;
    const end = new Date(drive.ended_at);
    const minutes = 20 + Math.round((drive.distance_km ?? 0) * 0.8);
    const stopEnd = new Date(end.getTime() + minutes * 60_000);
    stops.push({
      start: drive.ended_at,
      end: stopEnd.toISOString(),
      minutes,
      lat: last.lat,
      lng: last.lng,
      name: drive.to,
      source: "address",
    });
  }
  for (const charge of charges) {
    if (!charge.ended_at || charge.lat == null || charge.lng == null) continue;
    const end = new Date(charge.ended_at);
    const minutes = 25 + Math.round(charge.kwh ?? 0);
    const stopEnd = new Date(end.getTime() + minutes * 60_000);
    stops.push({
      start: charge.ended_at,
      end: stopEnd.toISOString(),
      minutes,
      lat: charge.lat,
      lng: charge.lng,
      name: charge.address,
      source: "address",
    });
  }
  return stops.sort((a, b) => a.start.localeCompare(b.start));
}

export function deriveTimeline(data: CarDataset, days: number, now: Date): TimelineData {
  const since = new Date(now.getTime() - days * DAY_MS);
  const inRange = (iso: string | null) => {
    if (!iso) return false;
    const when = new Date(iso);
    return when >= since && when <= now;
  };

  const drives = data.drives.filter((drive) => inRange(drive.started_at));
  const charges = data.charges.filter((charge) => inRange(charge.started_at));

  // 车辆状态区间：在线 / 睡眠交替，让时间带上的灰色条有内容
  const states: { state: string; start: string; end: string }[] = [];
  let cursor = new Date(since);
  const rng = new Rng(data.scenario.id * 31 + 7);
  while (cursor < now) {
    const online = rng.chance(0.55);
    const span = rng.int(40, 260);
    const end = new Date(Math.min(cursor.getTime() + span * 60_000, now.getTime()));
    states.push({
      state: online ? "online" : "asleep",
      start: cursor.toISOString(),
      end: end.toISOString(),
    });
    cursor = end;
  }

  return {
    days,
    since: since.toISOString(),
    until: now.toISOString(),
    drives: drives.map((drive) => ({
      start: drive.started_at,
      end: drive.ended_at,
      distance_km: drive.distance_km,
      from: drive.from,
      to: drive.to,
    })),
    charges: charges.map((charge) => ({
      start: charge.started_at,
      end: charge.ended_at,
      kwh: charge.kwh,
      lat: charge.lat,
      lng: charge.lng,
      name: charge.address,
    })),
    stops: deriveStops(drives, charges, data.series),
    states,
    states_available: true,
  };
}

export function deriveStatus(data: CarDataset, now: Date): VehicleStatus {
  const { scenario } = data;
  const capacityNow = scenario.nominalKwh * scenario.healthNow;
  const kwhPerKm = scenario.baseConsumption / 100;

  const soc = data.currentSoc;
  const ageMin = 4;

  return {
    car_id: data.car.id,
    available: true,
    soc: Math.round(soc),
    usable_soc: Math.max(0, Math.round(soc) - 4),
    range_km: Math.round((capacityNow / kwhPerKm) * (soc / 100)),
    odometer_km: data.odometer,
    updated_at: new Date(now.getTime() - ageMin * 60_000).toISOString(),
    age_min: ageMin,
    charging: false,
  };
}

/** demo 的基准时刻：整点取整，保证同一小时内反复打开数据完全一致。 */
export function demoNow(): Date {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return now;
}

let cached: { key: number; dataset: DemoDataset } | null = null;

/** 生成（并缓存）整套 demo 数据。跨整点会自动重建，保证「今天」永远是最新的。 */
export function buildDemoDataset(now: Date = demoNow()): DemoDataset {
  const key = now.getTime();
  if (cached && cached.key === key) return cached.dataset;

  const cars = new Map<number, CarDataset>();
  for (const scenario of SCENARIOS) {
    cars.set(scenario.id, buildCar(scenario, now));
  }

  const first = [...cars.values()][0];
  const meta: Meta = {
    cars: [...cars.values()].map((data) => data.car),
    nominal_kwh: first.scenario.nominalKwh,
    range: {
      first_drive: first.drives.length ? first.drives[first.drives.length - 1].started_at : null,
      last_drive: first.drives.length ? first.drives[0].started_at : null,
    },
    demo_scenarios: SCENARIOS.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      tagline: scenario.tagline,
    })),
  };

  cached = { key, dataset: { meta, cars } };
  return cached.dataset;
}
