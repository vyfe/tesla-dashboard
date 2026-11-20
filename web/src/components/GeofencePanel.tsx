import { useEffect, useRef, useState } from "react";
import type L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api";
import type { Geofence } from "../types";
import { wgs84ToGcj02 } from "../lib/gcj02";
import { loadLeaflet } from "../lib/leaflet";
import { Empty, ErrorBox, Loading, Panel } from "./Panel";
import { dateTime, kwh, n, price } from "../lib/format";

/** 一张只显示收藏点圈范围的小地图。 */
function GeofenceMap({ geofences }: { geofences: Geofence[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const leafletRef = useRef<typeof L | null>(null);
  // Leaflet 是异步加载的，加载完要再触发一次绘制
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const leaflet = await loadLeaflet();
      if (disposed || !containerRef.current || mapRef.current) return;
      leafletRef.current = leaflet;
      const map = leaflet.map(containerRef.current, {
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: false,
        dragging: true,
        doubleClickZoom: false,
      });
      mapRef.current = map;
      leaflet
        .tileLayer(
          "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
          { subdomains: "1234", maxZoom: 18 },
        )
        .addTo(map);
      setReady(true);
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const leaflet = leafletRef.current;
    if (!map || !leaflet) return;

    const layer = leaflet.layerGroup().addTo(map);
    const points: [number, number][] = [];
    for (const item of geofences) {
      if (item.lat == null || item.lng == null) continue;
      const [lng, lat] = wgs84ToGcj02(item.lng, item.lat);
      points.push([lat, lng]);
      // 半径换算成米：纬度 1 度约 111320 米
      const meters = item.radius;
      leaflet
        .circle([lat, lng], {
          radius: meters,
          color: "#2563eb",
          weight: 1.5,
          fillColor: "#2563eb",
          fillOpacity: 0.1,
        })
        .bindTooltip(`${item.name} · 半径 ${item.radius} m`, { direction: "top" })
        .addTo(layer);
      leaflet
        .marker([lat, lng], {
          icon: leaflet.divIcon({
            className: "drive-map-marker",
            html: '<div class="drive-map-marker-body" style="background:#2563eb"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
          interactive: false,
        })
        .addTo(layer);
    }
    if (points.length) {
      map.fitBounds(leaflet.latLngBounds(points).pad(0.6), { animate: false });
    }
    return () => {
      map.removeLayer(layer);
    };
  }, [geofences, ready]);

  if (geofences.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-xl border border-line-soft bg-panel-2 text-[12px] text-dim">
        还没有收藏点
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className="h-[240px] w-full overflow-hidden rounded-xl border border-line-soft"
    />
  );
}

function billingLabel(item: Geofence): string {
  return item.billing_type === "per_minute" ? "每分钟" : "每度电";
}

function GeofenceCard({
  item,
  writable,
  onChanged,
  onEdit,
  onDelete,
}: {
  item: Geofence;
  writable: boolean;
  onChanged: () => void;
  onEdit: (item: Geofence) => void;
  onDelete: (item: Geofence) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const recalculate = async (force: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.recalculateGeofence(item.id, {
        link_history: true,
        force,
      });
      const parts = [`关联 ${result.linked} 条`, `更新 ${result.updated} 条`];
      if (result.still_unpriced > 0) parts.push(`仍有 ${result.still_unpriced} 条未计费`);
      setMessage(parts.join(" · "));
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line-soft bg-panel-2 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <i className="h-2 w-2 shrink-0 rounded-full bg-[#2563eb]" />
            <span className="truncate text-[13px] font-medium">{item.name}</span>
          </div>
          <div className="mt-1 text-[11px] text-dim">
            半径 {item.radius} m ·{" "}
            {billingLabel(item)}
            {item.cost_per_unit !== null ? ` ${price(item.cost_per_unit)}` : ""}
            {item.session_fee !== null ? ` · 服务费 ¥${price(item.session_fee, 2)}` : ""}
          </div>
        </div>
        {writable && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => onEdit(item)}
              className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-hover hover:text-ink"
            >
              编辑
            </button>
            <button
              type="button"
              onClick={() => onDelete(item)}
              className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              删除
            </button>
          </div>
        )}
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["充电次数", String(item.charges)],
          ["累计费用", item.total_cost !== null ? `¥${n(item.total_cost, 2)}` : "—"],
          ["累计充入", item.energy_added !== null ? kwh(item.energy_added, 1) : "—"],
          ["单次均价", item.avg_cost !== null ? `¥${n(item.avg_cost, 2)}` : "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line-soft bg-panel px-2 py-1.5">
            <div className="text-[10px] text-dim">{label}</div>
            <div className="num mt-0.5 text-[12px]">{value}</div>
          </div>
        ))}
      </div>

      {item.last_charge_at && (
        <div className="mt-1.5 text-[10px] text-dim">最近一次 {dateTime(item.last_charge_at)}</div>
      )}
      {item.unpriced_charges > 0 && (
        <div className="mt-1 text-[10px] text-warn">
          有 {item.unpriced_charges} 次充电还没算价
        </div>
      )}

      {writable && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => recalculate(false)}
            className="rounded-md border border-line px-2 py-0.5 text-[10px] text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
          >
            补算缺价
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => recalculate(true)}
            className="rounded-md border border-line px-2 py-0.5 text-[10px] text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
          >
            按现价重算全部
          </button>
          {message && <span className="text-[10px] text-dim">{message}</span>}
        </div>
      )}
    </div>
  );
}

export function GeofencePanel() {
  const [items, setItems] = useState<Geofence[]>([]);
  const [writable, setWritable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Geofence | "new" | null>(null);

  const load = () => {
    setLoading(true);
    api
      .geofences()
      .then((value) => {
        setItems(value.geofences);
        setWritable(value.writable);
        setError(null);
      })
      .catch((err) => setError(err.message ?? String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <Panel
      title="收藏点与充电定价"
      hint={writable ? "圈定范围 + 单价，命中圈内自动计费" : "只读"}
    >
      <div className="space-y-3 px-4 py-3.5">
        {error && <ErrorBox message={error} />}
        {loading ? (
          <Loading />
        ) : items.length === 0 && !error ? (
          <Empty>还没有收藏点</Empty>
        ) : (
          <>
            <GeofenceMap geofences={items} />
            <div className="space-y-2">
              {items.map((item) => (
                <GeofenceCard
                  key={item.id}
                  item={item}
                  writable={writable}
                  onChanged={load}
                  onEdit={setEditing}
                  onDelete={(target) => {
                    if (!window.confirm(`删除收藏点「${target.name}」？历史充电费用会保留。`)) return;
                    api
                      .deleteGeofence(target.id)
                      .then(load)
                      .catch((err) => setError(err.message ?? String(err)));
                  }}
                />
              ))}
            </div>
            {writable && (
              <button
                type="button"
                onClick={() => setEditing("new")}
                className="w-full rounded-lg border border-line py-1.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink"
              >
                + 新建收藏点
              </button>
            )}
          </>
        )}
      </div>

      {editing && (
        <GeofenceEditor
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </Panel>
  );
}

/** 新建 / 编辑收藏点。 */
function GeofenceEditor({
  item,
  onClose,
  onSaved,
}: {
  item: Geofence | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [lat, setLat] = useState(item?.lat?.toString() ?? "");
  const [lng, setLng] = useState(item?.lng?.toString() ?? "");
  const [radius, setRadius] = useState(String(item?.radius ?? 100));
  const [billingType, setBillingType] = useState(item?.billing_type ?? "per_kwh");
  const [costPerUnit, setCostPerUnit] = useState(
    item?.cost_per_unit != null ? String(item.cost_per_unit) : "",
  );
  const [sessionFee, setSessionFee] = useState(
    item?.session_fee != null ? String(item.session_fee) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const payload = {
      name,
      lat: Number(lat),
      lng: Number(lng),
      radius: Number(radius),
      billing_type: billingType,
      cost_per_unit: costPerUnit === "" ? null : Number(costPerUnit),
      session_fee: sessionFee === "" ? null : Number(sessionFee),
    };
    try {
      if (item) await api.updateGeofence(item.id, payload);
      else await api.createGeofence(payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const field =
    "mt-0.5 w-full rounded-[7px] border border-line bg-panel-2 px-2 py-1.5 text-[12px] text-ink";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-panel shadow-[var(--shadow)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="收藏点设置"
      >
        <div className="flex items-center border-b border-line-soft px-5 py-3.5">
          <span className="text-[14px] font-medium">
            {item ? "编辑收藏点" : "新建收藏点"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            关闭
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {error && <ErrorBox message={error} />}
          <label className="block">
            <span className="text-[11px] text-muted">名称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：家门口充电桩"
              className={field}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-muted">纬度</span>
              <input
                value={lat}
                onChange={(event) => setLat(event.target.value)}
                placeholder="39.91788"
                className={field}
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted">经度</span>
              <input
                value={lng}
                onChange={(event) => setLng(event.target.value)}
                placeholder="116.27738"
                className={field}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] text-muted">半径（米）</span>
            <input
              value={radius}
              onChange={(event) => setRadius(event.target.value)}
              placeholder="100"
              className={field}
            />
          </label>

          <div>
            <span className="text-[11px] text-muted">计费方式</span>
            <div className="mt-1 flex gap-1.5">
              {[
                { value: "per_kwh", label: "每度电" },
                { value: "per_minute", label: "每分钟" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setBillingType(option.value as Geofence["billing_type"])}
                  className={
                    "rounded-[7px] border px-2.5 py-1 text-[11px] transition-colors " +
                    (billingType === option.value
                      ? "border-line bg-panel-2 text-ink"
                      : "border-line-soft text-muted hover:bg-hover hover:text-ink")
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-muted">
                单价（{billingType === "per_minute" ? "元/分钟" : "元/度"}）
              </span>
              <input
                value={costPerUnit}
                onChange={(event) => setCostPerUnit(event.target.value)}
                placeholder="0.9"
                className={field}
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted">服务费（元）</span>
              <input
                value={sessionFee}
                onChange={(event) => setSessionFee(event.target.value)}
                placeholder="可不填"
                className={field}
              />
            </label>
          </div>
          <p className="text-[10px] leading-relaxed text-dim">
            计价公式与 TeslaMate 一致：每度电按「取电量与充入量的较大值」算，每分钟按充电时长算，
            再加上服务费。保存后写入 TeslaMate 的 geofences 表，两个界面同步。
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-line-soft px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            取消
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-[12px] text-ink transition-colors hover:bg-hover disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
