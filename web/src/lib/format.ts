/** 数字、时间、单位的统一格式化，避免每个组件各写一套。 */

export function n(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function km(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${n(value, digits)} km`;
}

export function kwh(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${n(value, digits)} kWh`;
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
