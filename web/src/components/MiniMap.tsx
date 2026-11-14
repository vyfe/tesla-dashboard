import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type L from "leaflet";
import "leaflet/dist/leaflet.css";
import { loadLeaflet } from "../lib/leaflet";
import { wgs84ToGcj02 } from "../lib/gcj02";

/**
 * 地点小地图：只有一个点，用于「悬停某个地点 → 直接看到它在哪儿」。
 * 底图用高德（GCJ-02），所以坐标要先做一次偏移。
 */
export function MiniMap({
  lat,
  lng,
  zoom = 15,
  className = "h-[150px] w-[240px]",
}: {
  lat: number;
  lng: number;
  zoom?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const leaflet = await loadLeaflet();
      if (disposed || !containerRef.current || mapRef.current) return;
      const [lngGcj, latGcj] = wgs84ToGcj02(lng, lat);
      const map = leaflet.map(containerRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
      });
      mapRef.current = map;
      leaflet
        .tileLayer("https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}", {
          subdomains: "1234",
          maxZoom: 18,
          attribution: '© <a href="https://www.amap.com/" target="_blank" rel="noreferrer">高德地图</a>',
        })
        .addTo(map);
      leaflet
        .marker([latGcj, lngGcj], {
          icon: leaflet.divIcon({
            className: "drive-map-marker",
            html: '<div class="drive-map-marker-body" style="background:#2563eb"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
          interactive: false,
        })
        .addTo(map);
      map.setView([latGcj, lngGcj], zoom, { animate: false });
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [lat, lng, zoom]);

  return <div ref={containerRef} className={className} />;
}

interface HoverMapProps {
  lat: number | null;
  lng: number | null;
  /** 标题：地点名 */
  title?: string | null;
  /** 副标题：停留时长等补充信息 */
  subtitle?: string | null;
  children: React.ReactNode;
}

/**
 * 把任意子元素变成「悬停出小地图」的触发器。
 * 小地图挂在 body 上（portal），避免被时间轴那行的 overflow-hidden 裁掉。
 */
export function HoverMap({ lat, lng, title, subtitle, children }: HoverMapProps) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  const show = (event: React.MouseEvent<HTMLSpanElement>) => {
    if (lat == null || lng == null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 240;
    const height = 150;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const top = rect.bottom + 8 + height > window.innerHeight ? rect.top - height - 8 : rect.bottom + 8;
    setAnchor({ x: left, y: Math.max(8, top) });
  };

  const hide = () => setAnchor(null);

  return (
    <>
      <span onMouseEnter={show} onMouseLeave={hide} className="inline-flex">
        {children}
      </span>
      {anchor && lat != null && lng != null
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[1200] overflow-hidden rounded-lg border border-line bg-panel shadow-[var(--shadow)]"
              style={{ left: anchor.x, top: anchor.y, width: 240 }}
            >
              <MiniMap lat={lat} lng={lng} />
              {(title || subtitle) && (
                <div className="border-t border-line-soft px-2 py-1.5 text-[11px] leading-tight">
                  {title && <div className="truncate font-medium">{title}</div>}
                  {subtitle && <div className="text-[10px] text-dim">{subtitle}</div>}
                </div>
              )}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
