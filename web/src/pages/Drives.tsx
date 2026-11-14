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
import { DriveMap } from "../components/DriveMap";
import { Empty, ErrorBox, Loading, Panel } from "../components/Panel";
import { TooltipBox, useChartTheme } from "../components/chart";
import { useChartColors } from "../lib/theme";
import { dateTime, duration, km, kwh, n, timeOfDay } from "../lib/format";

const PAGE_SIZE = 25;

function DriveTooltip({ active, payload, label }: any) {
  const colors = useChartColors();
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload ?? {};
  return (
    <TooltipBox
      label={timeOfDay(String(label))}
      rows={[
        { name: "车速", value: n(point.speed, 0), unit: "km/h", color: colors.info },
        { name: "功率", value: n(point.power, 1), unit: "kW", color: colors.accent },
        { name: "电量", value: n(point.soc, 0), unit: "%", color: colors.good },
      ]}
    />
  );
}

function DriveModal({ id, carId, onClose }: { id: number; carId?: number; onClose: () => void }) {
  const [detail, setDetail] = useState<DriveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const theme = useChartTheme();

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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-line bg-panel shadow-[var(--shadow)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="行程详情"
      >
        <div className="flex items-start gap-3 border-b border-line-soft px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-[15px] font-medium">
              <span>{detail?.drive.from ?? "…"}</span>
              <span className="text-dim">→</span>
              <span>{detail?.drive.to ?? "…"}</span>
            </div>
            <div className="num mt-1 text-[11px] text-muted">
              {detail ? dateTime(detail.drive.started_at) : "加载中"}
              {detail && (
                <>
                  {" · "}
                  {km(detail.drive.distance_km)} · {duration(detail.drive.duration_min)} ·{" "}
                  {kwh(detail.drive.energy_kwh, 2)}
                  {detail.drive.consumption ? ` · ${n(detail.drive.consumption, 1)} kWh/100km` : ""}
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:bg-hover hover:text-ink"
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
              {detail.series.some((p) => p.lat != null && p.lng != null) ? (
                <div>
                  <div className="mb-2 text-[10px] text-dim">行程轨迹</div>
                  <DriveMap points={detail.series} />
                </div>
              ) : (
                <div className="rounded-xl border border-line-soft bg-panel-2 px-3 py-2 text-[12px] text-dim">
                  这条行程没有坐标信息，无法绘制轨迹。
                </div>
              )}

              <div>
                <div className="mb-2 text-[10px] text-dim">速度 / 功率</div>
                <div className="h-[210px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={detail.series} margin={{ top: 6, right: 6, bottom: 0, left: 2 }}>
                      <CartesianGrid {...theme.gridProps} />
                      <XAxis dataKey="t" tickFormatter={timeOfDay} minTickGap={40} {...theme.axisProps} />
                      <YAxis yAxisId="speed" width={44} {...theme.axisProps} />
                      <YAxis yAxisId="power" orientation="right" width={40} {...theme.axisProps} />
                      <Tooltip content={<DriveTooltip />} cursor={theme.cursor} />
                      <Area
                        yAxisId="speed"
                        type="monotone"
                        dataKey="speed"
                        stroke={theme.colors.info}
                        strokeWidth={1.6}
                        fill={theme.colors.info}
                        fillOpacity={0.12}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="power"
                        type="monotone"
                        dataKey="power"
                        stroke={theme.colors.accent}
                        strokeWidth={1.6}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <div className="mb-2 text-[10px] text-dim">电量</div>
                <div className="h-[120px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={detail.series} margin={{ top: 4, right: 6, bottom: 0, left: 2 }}>
                      <CartesianGrid {...theme.gridProps} />
                      <XAxis dataKey="t" tickFormatter={timeOfDay} minTickGap={40} {...theme.axisProps} />
                      <YAxis width={40} domain={["dataMin - 3", "dataMax + 3"]} {...theme.axisProps} />
                      <Tooltip content={<DriveTooltip />} cursor={theme.cursor} />
                      <Area
                        type="monotone"
                        dataKey="soc"
                        stroke={theme.colors.good}
                        strokeWidth={1.6}
                        fill={theme.colors.good}
                        fillOpacity={0.1}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 text-[12px] sm:grid-cols-4">
                {[
                  ["最高车速", `${n(detail.drive.max_speed, 0)} km/h`],
                  ["均速", `${n(detail.drive.avg_speed, 1)} km/h`],
                  ["爬升 / 下降", `${n(detail.drive.ascent, 0)} / ${n(detail.drive.descent, 0)} m`],
                  ["车外温度", `${n(detail.drive.outside_temp, 1)} °C`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-line-soft bg-panel-2 px-3 py-2">
                    <div className="text-[10px] text-dim">{label}</div>
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
      days > 0 ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : undefined;
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
        <div className="flex gap-1 rounded-[10px] border border-line bg-panel p-1">
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              onClick={() => {
                setDays(range.days);
                setOffset(0);
              }}
              className={
                "rounded-[7px] px-3 py-1 text-[12px] transition-colors " +
                (days === range.days ? "bg-panel-2 text-ink shadow-[inset_0_0_0_1px_var(--line)]" : "text-muted hover:text-ink")
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] border-collapse">
              <thead>
                <tr className="border-b border-line-soft">
                  {["出发时间", "路线", "距离", "时长", "均速", "百公里电耗"].map((head, index) => (
                    <th
                      key={head}
                      className={`whitespace-nowrap px-3 py-2.5 text-[10px] font-medium text-dim sm:px-4 ${
                        index < 2 ? "text-left" : "text-right"
                      } ${index === 3 || index === 4 ? "hidden sm:table-cell" : ""}`}
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
                    className="cursor-pointer border-b border-line-soft last:border-0 hover:bg-hover"
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-muted sm:px-4">
                      {dateTime(drive.started_at)}
                    </td>
                    <td className="px-3 py-2.5 sm:px-4">
                      <div className="flex items-center gap-1.5 text-[13px]">
                        <span className="max-w-[140px] truncate">{drive.from}</span>
                        <span className="text-[10px] text-dim">→</span>
                        <span className="max-w-[140px] truncate">{drive.to}</span>
                      </div>
                    </td>
                    <td className="num whitespace-nowrap px-4 py-2.5 text-right text-[13px]">{km(drive.distance_km)}</td>
                    <td className="num hidden whitespace-nowrap px-4 py-2.5 text-right text-[13px] text-muted sm:table-cell">
                      {duration(drive.duration_min)}
                    </td>
                    <td className="num hidden whitespace-nowrap px-4 py-2.5 text-right text-[13px] text-muted sm:table-cell">
                      {n(drive.avg_speed, 1)}
                    </td>
                    <td
                      className="num whitespace-nowrap px-4 py-2.5 text-right text-[13px] text-muted"
                      title={drive.energy_kwh ? `${n(drive.energy_kwh, 2)} kWh` : undefined}
                    >
                      {drive.consumption ? n(drive.consumption, 1) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="flex items-center justify-between text-[12px] text-muted">
        <span>
          第 {page} / {pages} 页
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
            className="rounded-lg border border-line px-3 py-1.5 transition-colors hover:text-ink disabled:opacity-35"
          >
            上一页
          </button>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((value) => value + PAGE_SIZE)}
            className="rounded-lg border border-line px-3 py-1.5 transition-colors hover:text-ink disabled:opacity-35"
          >
            下一页
          </button>
        </div>
      </div>

      {openId !== null && <DriveModal id={openId} carId={carId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
