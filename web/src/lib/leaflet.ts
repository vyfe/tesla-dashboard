import type L from "leaflet";

/**
 * Leaflet 按需加载：整包 140KB，只有真正要用地图时才下载。
 * 多个组件共享同一个 Promise，避免重复 import 触发重复请求。
 */
let pending: Promise<typeof L> | null = null;

export function loadLeaflet(): Promise<typeof L> {
  pending ??= import("leaflet").then((mod) => mod.default);
  return pending;
}
