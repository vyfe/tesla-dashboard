import { useSyncExternalStore } from "react";
import { api } from "../api";

/**
 * 显示设置：单位、续航口径、主题等，跟 TeslaMate 的 settings 表同源。
 *
 * 用一个极小的外部 store，而不是逐层透传 props——格式化函数（km / temp）
 * 在很多地方被调用，让它们直接读当前设置最省事，改动也最小。
 */
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

export const DEFAULT_SETTINGS: Settings = {
  unit_of_length: "km",
  unit_of_temperature: "C",
  preferred_range: "rated",
  unit_of_pressure: "bar",
  language: "zh",
  theme_mode: "system",
  base_url: "",
  grafana_url: "",
};

let current: Settings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function setSettings(next: Partial<Settings>): void {
  current = { ...current, ...next };
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 订阅设置变化，设置一改就重新渲染。 */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

/** 公里 → 显示单位的换算（1 km = 0.621371 mi）。 */
export function toDistance(km: number, unit: Settings["unit_of_length"]): number {
  return unit === "mi" ? km * 0.621371 : km;
}

/** 摄氏度 → 华氏度。 */
export function toTemperature(celsius: number, unit: Settings["unit_of_temperature"]): number {
  return unit === "F" ? celsius * 1.8 + 32 : celsius;
}

/** kWh/100km → kWh/100mi（英制下每 100 英里消耗更多）。 */
export function toConsumption(per100km: number, unit: Settings["unit_of_length"]): number {
  return unit === "mi" ? per100km / 0.621371 : per100km;
}

/**
 * 把设置写回 TeslaMate。看板没配写入账号时（只读模式）会失败，
 * 这时静默忽略——本地切换仍然生效，只是两边不同步。
 */
export async function persistSettings(patch: Partial<Settings>): Promise<boolean> {
  const next = { ...getSettings(), ...patch };
  try {
    const result = await api.saveSettings(next);
    setSettings(result.settings);
    return true;
  } catch {
    return false;
  }
}
