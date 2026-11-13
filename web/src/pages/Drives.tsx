import { useEffect, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import type { Drive, DriveDetail } from "../types";
import { Empty, ErrorBox, Loading, Panel } from "../components/Panel";
import { AXIS_PROPS, GRID_PROPS, TooltipBox } from "../components/chart";
import { dateTime, duration, km, kwh, n, timeOfDay } from "../lib/format";

const PAGE_SIZE = 25;

function DriveTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload ?? {};
  return (
    <TooltipBox
      label={timeOfDay(String(label))}
      rows={[
        { name: "车速", value: n(point.speed, 0), unit: "km/h", color: "#58a6ff" },
        { name: "功率", value: n(point.power, 1), unit: "kW", color: "#e82127" },
        { name: "电量", value: n(point.soc, 0), unit: "%", color: "#3fb950" },
      ]}
    />
  );
}

function DriveModal({ id, carId, onClose }: { id: number; carId?: number; onClose: () => void }) {
  const [detail, setDetail] = useState<DriveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .drive(id, carId)
      .then((value) => alive && setDetail(value))
      .catch((err) => alive && setError(err.message ?? String(err)));
    return () => {
      alive = false;
    };
  }, [id, carId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-line bg-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-line-soft px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-[15px] font-medium">
              <span>{detail?.drive.from ?? "…"}</span>
              <span className="text-dim">→</span>
              <span>{detail?.drive.to ?? "…"}</span>
            </div>
            <div className="mt-0.5 text-[12px] text-muted">
              {detail ? dateTime(detail.drive.started_at) : "加载中"}
              {detail && (
                <>
                  {" · "}
                  {km(detail.drive.distance_km)} · {duration(detail.drive.duration_min)} ·{" "}
                  {kwh(detail.drive.energy_kwh, 2)}
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-ink"
          >
            关闭
          </button>
        </div>

        <div className="px-4 py-4">
          {error && <ErrorBox message={error} />}
          {!detail && !error && <Loading />}
          {detail && detail.series.length === 0 && <Empty>这次行程没有轨迹采样点</Empty>}
          {detail && detail.series.length > 0 && (
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-dim">速度 / 功率</div>
                <div className="h-[210px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={detail.series} margin={{ top: 6, right: 6, bottom: 0, left: 2 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="t" tickFormatter={timeOfDay} minTickGap={40} {...AXIS_PROPS} />
                      <YAxis yAxisId="speed" width={48} {...AXIS_PROPS} />
                      <YAxis yAxisId="power" orientation="right" width={44} {...AXIS_PROPS} />
                      <Tooltip content={<DriveTooltip />} cursor={{ stroke: "#2a3644" }} />
                      <Area
                        yAxisId="speed"
                        type="monotone"
                        dataKey="speed"
                        stroke="#58a6ff"
                        strokeWidth={1.6}
                        fill="#58a6ff"
                        fillOpacity={0.12}
                        dot={false} isAnimationActive={false}
                      />
                      <Line
                        yAxisId="power"
                        type="monotone"
                        dataKey="power"
                        stroke="#e82127"
                        strokeWidth={1.6}
                        dot={false} isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-dim">电量</div>
                <div className="h-[120px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={detail.series} margin={{ top: 4, right: 6, bottom: 0, left: 2 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="t" tickFormatter={timeOfDay} minTickGap={40} {...AXIS_PROPS} />
                      <YAxis width={44} domain={["dataMin - 3", "dataMax + 3"]} {...AXIS_PROPS} />
                      <Tooltip content={<DriveTooltip />} cursor={{ stroke: "#2a3644" }} />
                      <Area
                        type="monotone"
                        dataKey="soc"
                        stroke="#3fb950"
                        strokeWidth={1.6}
                        fill="#3fb950"
                        fillOpacity={0.1}
                        dot={false} isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1 text-[12px] sm:grid-cols-4">
                {[
                  ["最高车速", `${n(detail.drive.max_speed, 0)} km/h`],
                  ["均速", `${n(detail.drive.avg_speed, 1)} km/h`],
                  ["爬升 / 下降", `${n(detail.drive.ascent, 0)} / ${n(detail.drive.descent, 0)} m`],
                  ["车外温度", `${n(detail.drive.outside_temp, 1)} °C`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-line-soft bg-panel-2 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.06em] text-dim">{label}</div>
                    <div className="num mt-0.5 text-[13px]">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const RANGES = [
  { label: "近 30 天", days: 30 },
  { label: "近 90 天", days: 90 },
  { label: "近一年", days: 365 },
  { label: "全部", days: 0 },
];

export function Drives({ carId }: { carId?: number }) {
  const [items, setItems] = useState<Drive[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    const controller = { alive: true };
    setLoading(true);
    const dateFrom =
      days > 0
        ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
        : undefined;
    api
      .drives({ car: carId, limit: PAGE_SIZE, offset, date_from: dateFrom })
      .then((page) => {
        if (!controller.alive) return;
        setItems(page.items);
        setTotal(page.total);
        setError(null);
      })
      .catch((err) => controller.alive && setError(err.message ?? String(err)))
      .finally(() => controller.alive && setLoading(false));
    return () => {
      controller.alive = false;
    };
  }, [carId, offset, days]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-[10px] border border-line bg-panel-2 p-1">
          {RANGES.map((range) => (
            <button
              key={range.days}
              onClick={() => {
                setDays(range.days);
                setOffset(0);
              }}
              className={
                "rounded-[7px] px-3 py-1 text-[12px] transition-colors " +
                (days === range.days ? "bg-[#1b232d] text-ink" : "text-muted hover:text-ink")
              }
            >
              {range.label}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-dim">共 {n(total)} 次行程</span>
      </div>

      <Panel title="行程明细" hint="点击行查看速度 / 功率曲线">
        {error && <ErrorBox message={error} />}
        {!error && loading && <Loading />}
        {!error && !loading && items.length === 0 && <Empty>这个时间段没有行程</Empty>}
        {!error && !loading && items.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line-soft">
                {["出发时间", "路线", "距离", "时长", "均速", "电耗"].map((head, index) => (
                  <th
                    key={head}
                    className={`whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-dim ${
                      index < 2 ? "text-left" : "text-right"
                    }`}
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((drive) => (
                <tr
                  key={drive.id}
                  onClick={() => setOpenId(drive.id)}
                  className="cursor-pointer border-b border-[#131a22] last:border-0 hover:bg-[#0f151c]"
                >
                  <td className="whitespace-nowrap px-4 py-2.5 text-[13px] text-muted">
                    {dateTime(drive.started_at)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5 text-[13px]">
                      <span className="max-w-[140px] truncate">{drive.from}</span>
                      <span className="text-[10px] text-dim">→</span>
                      <span className="max-w-[140px] truncate">{drive.to}</span>
                    </div>
                  </td>
                  <td className="num px-4 py-2.5 text-right text-[13px]">{km(drive.distance_km)}</td>
                  <td className="num px-4 py-2.5 text-right text-[13px] text-muted">
                    {duration(drive.duration_min)}
                  </td>
                  <td className="num px-4 py-2.5 text-right text-[13px] text-muted">
                    {n(drive.avg_speed, 1)}
                  </td>
                  <td className="num px-4 py-2.5 text-right text-[13px] text-muted">
                    {kwh(drive.energy_kwh, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <div className="flex items-center justify-between text-[12px] text-muted">
        <span>
          第 {page} / {pages} 页
        </span>
        <div className="flex gap-2">
          <button
            disabled={offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
            className="rounded-lg border border-line px-3 py-1.5 transition-colors disabled:opacity-35 hover:text-ink"
          >
            上一页
          </button>
          <button
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((value) => value + PAGE_SIZE)}
            className="rounded-lg border border-line px-3 py-1.5 transition-colors disabled:opacity-35 hover:text-ink"
          >
            下一页
          </button>
        </div>
      </div>

      {openId !== null && <DriveModal id={openId} carId={carId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
