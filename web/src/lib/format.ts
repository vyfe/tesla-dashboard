/** 数字、时间、单位的统一格式化，避免每个组件各写一套。 */

import { getSettings, toConsumption, toDistance, toTemperature } from "./settings";

export function n(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function km(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  const { unit_of_length } = getSettings();
  return `${n(toDistance(value, unit_of_length), digits)} ${unit_of_length}`;
}

/** 距离数值（不带单位），给「数值 + 单位」分开排版的地方用。 */
export function distance(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return toDistance(value, getSettings().unit_of_length);
}

export function distanceUnit(): string {
  return getSettings().unit_of_length;
}

/** 温度：°C / °F 跟设置走。 */
export function temp(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  const { unit_of_temperature } = getSettings();
  return `${n(toTemperature(value, unit_of_temperature), digits)} °${unit_of_temperature}`;
}

/** 电耗：kWh/100km 或 kWh/100mi。 */
export function consumption(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  const { unit_of_length } = getSettings();
  return `${n(toConsumption(value, unit_of_length), digits)} kWh/100${unit_of_length}`;
}

export function kwh(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${n(value, digits)} kWh`;
}

/**
 * 单价/金额：不能带千分位。
 * n() 会给 0.6000 变成 "0.6,000"（小数点后三位被当成千位分组），所以单独写一个。
 */
export function price(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined) return "—";
  const text = value.toFixed(digits);
  // 去掉末尾多余的 0，但至少保留一位小数
  return text.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${n(value, digits)}%`;
}

export function duration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** 停留时长：分钟 / 小时 / 天，跨度大的用大单位更好读。 */
export function stopDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "—";
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} 小时`;
  return `${(minutes / 1440).toFixed(1)} 天`;
}

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

export function monthLabel(month: string): string {
  const [year, index] = month.split("-");
  return `${year.slice(2)}-${MONTHS[Number(index) - 1] ?? "01"}`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${m}-${d}`;
}

export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function delta(current: number, previous: number): { text: string; up: boolean } | null {
  if (!previous || !current) return null;
  const ratio = (current - previous) / previous;
  return {
    text: `${ratio >= 0 ? "↑" : "↓"} ${Math.abs(ratio * 100).toFixed(0)}%`,
    up: ratio >= 0,
  };
}

/** 给坐标轴算一组「好看」的刻度：整步长、整数刻度，避免 75.28 这种值。 */
export function niceScale(values: number[], tickCount = 4): { domain: [number, number]; ticks: number[] } {
  if (!values.length) return { domain: [0, 1], ticks: [0, 1] };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(hi - lo, 1e-6);
  const rawStep = span / Math.max(tickCount - 1, 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let value = min; value <= max + step / 1000; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return { domain: [min, max], ticks };
}
