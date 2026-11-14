import { useEffect, useRef, useState } from "react";
import type L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { SeriesPoint } from "../types";
import { wgs84ToGcj02 } from "../lib/gcj02";

interface Basemap {
  id: string;
  label: string;
  url: string;
  /** 瓦片子域；不填就用 Leaflet 默认的 abc */
  subdomains?: string;
  maxZoom: number;
  /**
   * 底图是否使用 GCJ-02（国内互联网地图坐标系）。
   * true 时轨迹必须先从 WGS-84 偏移过去，否则整条线会偏出道路。
   */
  gcj02: boolean;
  attribution: string;
}

const AMAP_ATTR =
  '© <a href="https://www.amap.com/" target="_blank" rel="noreferrer">高德地图</a> GS(2021)1024号';

const BASEMAPS: Basemap[] = [
  {
    id: "amap",
    label: "高德路网",
    url: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
    subdomains: "1234",
    maxZoom: 18,
    gcj02: true,
    attribution: AMAP_ATTR,
  },
  {
    id: "amap-sat",
    label: "高德卫星",
    url: "https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
    subdomains: "1234",
    maxZoom: 18,
    gcj02: true,
    attribution: AMAP_ATTR,
  },
  {
    id: "amap-hybrid",
    label: "高德影像路网",
    url: "https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}",
    subdomains: "1234",
    maxZoom: 18,
    gcj02: true,
    attribution: AMAP_ATTR,
  },
  // OpenStreetMap（tile.openstreetmap.org）和 CARTO 暗色底图（basemaps.cartocdn.com）
  // 在国内访问不稳定，已下线；需要时把条目加回来即可，gcj02 标记决定要不要做坐标偏移。
];

/** 速度分档配色：慢→快 蓝→青→绿→黄→橙→红。 */
const SPEED_STEPS: Array<[number, string]> = [
  [0, "#3b82f6"],
  [15, "#06b6d4"],
  [30, "#22c55e"],
  [50, "#eab308"],
  [70, "#f97316"],
  [90, "#ef4444"],
];

function speedColor(speed: number | null | undefined): string {
  const value = speed ?? 0;
  let color = SPEED_STEPS[0][1];
  for (const [limit, c] of SPEED_STEPS) {
    if (value >= limit) color = c;
  }
  return color;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string
  );
}

function popupHtml(point: SeriesPoint): string {
  const rows: Array<[string, string]> = [
    ["速度", point.speed != null ? `${point.speed} km/h` : "—"],
    ["功率", point.power != null ? `${point.power} kW` : "—"],
    ["电量", point.soc != null ? `${point.soc} %` : "—"],
    ["海拔", point.elevation != null ? `${point.elevation} m` : "—"],
  ];
  const body = rows
    .map(
      ([name, value]) =>
        `<tr><td style="padding:1px 8px 1px 0;color:#888">${name}</td><td>${value}</td></tr>`
    )
    .join("");
  return `<div style="font-size:12px;line-height:1.6"><div style="margin-bottom:3px;font-weight:600">${escapeHtml(
    point.t.slice(11, 19)
  )}</div><table style="border-collapse:collapse">${body}</table></div>`;
}

function markerIcon(leaflet: typeof L, text: string, color: string): L.DivIcon {
  return leaflet.divIcon({
    className: "drive-map-marker",
    html: `<div class="drive-map-marker-body" style="background:${color}">${text}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

type Sample = { point: SeriesPoint; coord: [number, number] };

export function DriveMap({ points, height = 320 }: { points: SeriesPoint[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const trackRef = useRef<L.LayerGroup | null>(null);
  const activeRef = useRef<string>(BASEMAPS[0].id);
  // 当前轨迹的采样点（含换算后的坐标），供地图点击时找最近的点
  const samplesRef = useRef<Sample[]>([]);
  // Leaflet 有 140KB，动态 import 拆成独立 chunk，只有打开行程弹窗才下载。
  const leafletRef = useRef<typeof L | null>(null);
  const [ready, setReady] = useState(false);
  // 底图换了坐标系要重画轨迹，用一个计数器触发重绘。
  const [tick, setTick] = useState(0);

  // 地图只建一次；换行程时只重建轨迹层。
  useEffect(() => {
    let disposed = false;
    (async () => {
      const mod = await import("leaflet");
      if (disposed || !containerRef.current || mapRef.current) return;
      const L = mod.default;
      leafletRef.current = L;

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true,
        dragging: true,
        touchZoom: true,
        doubleClickZoom: true,
      });
      mapRef.current = map;

      // 图层名取自对象的 key，所以用中文标签做 key，切换器里显示的才是「高德路网」这种名字。
      const tiles: Record<string, L.TileLayer> = {};
      const owner = new Map<L.TileLayer, Basemap>();
      for (const base of BASEMAPS) {
        const options: L.TileLayerOptions = {
          maxZoom: base.maxZoom,
          attribution: base.attribution,
          crossOrigin: true,
        };
        // 不能写 subdomains: base.subdomains——OSM 那层没有子域，传 undefined
        // 会把 Leaflet 默认的 'abc' 覆盖掉，取瓦片 URL 时直接抛错。
        if (base.subdomains) options.subdomains = base.subdomains;
        const layer = L.tileLayer(base.url, options);
        tiles[base.label] = layer;
        owner.set(layer, base);
      }
      L.control.layers(tiles, undefined, { position: "topright" }).addTo(map);
      tiles[BASEMAPS[0].label].addTo(map);

      trackRef.current = L.layerGroup().addTo(map);

      map.on("baselayerchange", (event: L.LayersControlEvent) => {
        const base = owner.get(event.layer as L.TileLayer);
        if (base) {
          activeRef.current = base.id;
          setTick((n) => n + 1);
        }
      });

      // 点地图找最近的采样点弹窗。
      // 不用图层自身的 popup：canvas 渲染器的命中容差是图层像素，缩放到城区
      // （zoom 13 上下）后只有 0.1 屏幕像素，根本点不中；而且 canvas 上的点击
      // 也不会冒泡成 map 事件。SVG 渲染器 + 地图级命中，稳得多。
      map.on("click", (event: L.LeafletMouseEvent) => {
        const samples = samplesRef.current;
        if (samples.length === 0) return;
        const target = map.latLngToContainerPoint(event.latlng);
        let best: Sample | null = null;
        let bestDistance = 30; // 像素
        for (const sample of samples) {
          const at = map.latLngToContainerPoint(L.latLng(sample.coord));
          const distance = at.distanceTo(target);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = sample;
          }
        }
        if (!best) return;
        L.popup()
          .setLatLng(L.latLng(best.coord))
          .setContent(popupHtml(best.point))
          .openOn(map);
      });

      setReady(true);
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      trackRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  // 轨迹：按速度分色，底图切换坐标系时整体重建。
  useEffect(() => {
    const map = mapRef.current;
    const track = trackRef.current;
    const L = leafletRef.current;
    if (!map || !track || !L) return;

    const base = BASEMAPS.find((b) => b.id === activeRef.current) ?? BASEMAPS[0];
    const usable = points.filter((p) => p.lat != null && p.lng != null);
    track.clearLayers();
    samplesRef.current = [];
    if (usable.length === 0) return;

    const shifted: Sample[] = usable.map((p) => {
      const lng = p.lng as number;
      const lat = p.lat as number;
      const [x, y] = base.gcj02 ? wgs84ToGcj02(lng, lat) : [lng, lat];
      return { point: p, coord: [y, x] as [number, number] };
    });
    samplesRef.current = shifted;

    // 每一段单独画一条线，才能按速度分色
    for (let i = 1; i < shifted.length; i += 1) {
      const from = shifted[i - 1];
      const to = shifted[i];
      const midSpeed = ((from.point.speed ?? 0) + (to.point.speed ?? 0)) / 2;
      L.polyline([from.coord, to.coord], {
        color: speedColor(midSpeed),
        weight: 4,
        opacity: 0.95,
        lineCap: "round",
        interactive: false,
      }).addTo(track);
    }

    L.marker(shifted[0].coord, { icon: markerIcon(L, "起", "#16a34a") }).addTo(track);
    L.marker(shifted[shifted.length - 1].coord, { icon: markerIcon(L, "终", "#dc2626") }).addTo(track);

    map.fitBounds(L.latLngBounds(shifted.map((item) => item.coord)), { padding: [24, 24] });
  }, [points, tick, ready]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-xl border border-line-soft"
        style={{ height }}
      />
      <div className="pointer-events-none absolute bottom-6 left-2 z-[500] rounded-lg border border-line-soft bg-panel/85 px-2 py-1.5 text-[10px] text-muted backdrop-blur">
        <div className="mb-1">速度</div>
        <div className="flex items-center gap-1">
          {SPEED_STEPS.map(([limit, color], index) => (
            <span key={limit} className="flex flex-col items-center">
              <span className="h-1.5 w-5 rounded-sm" style={{ background: color }} />
              <span className="mt-0.5 text-[9px] text-dim">
                {index === 0 ? "0" : limit}
                {index === SPEED_STEPS.length - 1 ? "+" : ""}
              </span>
            </span>
          ))}
        </div>
        <div className="mt-0.5 text-[9px] text-dim">km/h</div>
      </div>
    </div>
  );
}
