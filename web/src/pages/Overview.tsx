import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import type { Overview as OverviewData } from "../types";
import { ErrorBox, Empty, Kpi, Loading, Panel } from "../components/Panel";
import { AXIS_PROPS, GRID_PROPS, TooltipBox } from "../components/chart";
import { dateTime, dayLabel, delta, duration, km, kwh, n, pct, timeOfDay } from "../lib/format";
import type { Tab } from "../components/Shell";

interface Props {
  carId?: number;
  onNavigate: (tab: Tab) => void;
}

function DailyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return <TooltipBox label={dayLabel(String(label))} rows={[{ name: "里程", value: n(payload[0].value, 1), unit: "km", color: "#e82127" }]} />;
}

export function Overview({ carId, onNavigate }: Props) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .overview(carId)
      .then((value) => alive && setData(value))
      .catch((err) => alive && setError(err.message ?? String(err)));
    return () => {
      alive = false;
    };
  }, [carId]);

  if (error) return <ErrorBox message={error} hint="检查 api 容器的 DATABASE_URL 是否能连到 TeslaMate 的 PostgreSQL。" />;
  if (!data) return <Loading />;

  const { kpis } = data;
  const change = delta(kpis.month_km, kpis.prev_month_km);
  const maxDaily = Math.max(...data.daily.map((d) => d.km), 1);

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="本月里程"
          value={n(kpis.month_km, 0)}
          unit="km"
          hint={change ? `${change.text} 对比上月` : "本月刚开始"}
        />
        <Kpi
          label="行程数"
          value={n(kpis.month_drives)}
          unit="次"
          hint={kpis.avg_trip_km ? `平均 ${n(kpis.avg_trip_km, 1)} km / 次` : undefined}
        />
        <Kpi
          label="平均电耗"
          value={kpis.consumption ? n(kpis.consumption, 1) : "—"}
          unit="kWh/100km"
          hint={`按 ${n(kpis.nominal_kwh, 1)} kWh 标称容量折算`}
        />
        <Kpi
          label="电池健康"
          value={kpis.battery_health ? n(kpis.battery_health, 1) : "—"}
          unit="%"
          hint={kpis.capacity_kwh ? `估算容量 ${n(kpis.capacity_kwh, 1)} kWh` : "样本不足"}
          tone={kpis.battery_health && kpis.battery_health < 90 ? "warn" : "good"}
        />
      </div>

      <Panel title="近 30 天里程" hint={`峰值 ${n(maxDaily, 1)} km`}>
        <div className="h-[190px] px-2 pb-3 pt-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.daily} margin={{ top: 4, right: 14, bottom: 0, left: 2 }}>
              <defs>
                <linearGradient id="dailyFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e82127" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="#e82127" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tickFormatter={dayLabel} interval={4} {...AXIS_PROPS} />
              <YAxis width={48} {...AXIS_PROPS} />
              <Tooltip content={<DailyTooltip />} cursor={{ stroke: "#2a3644" }} />
              <Area
                type="monotone"
                dataKey="km"
                stroke="#e82127"
                strokeWidth={2}
                fill="url(#dailyFill)"
                dot={false} isAnimationActive={false}
                activeDot={{ r: 3, fill: "#e82127", stroke: "#0a0d12", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid gap-3.5 lg:grid-cols-[1.55fr_1fr]">
        <Panel
          title="最近行程"
          hint="点击「行程」查看曲线"
          action={
            <button
              onClick={() => onNavigate("drives")}
              className="text-[11px] text-muted transition-colors hover:text-ink"
            >
              全部 →
            </button>
          }
        >
          {data.recent_drives.length === 0 ? (
            <Empty>还没有行程记录</Empty>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line-soft">
                  {["路线", "距离", "时长", "电耗"].map((head, index) => (
                    <th
                      key={head}
                      className={`px-4 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-dim ${
                        index === 0 ? "text-left" : "text-right"
                      }`}
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recent_drives.map((drive) => (
                  <tr key={drive.id} className="border-b border-[#131a22] last:border-0 hover:bg-[#0f151c]">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 text-[13px]">
                        <span className="max-w-[130px] truncate">{drive.from}</span>
                        <span className="text-[10px] text-dim">→</span>
                        <span className="max-w-[130px] truncate">{drive.to}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-dim">
                        {dateTime(drive.started_at)} · 均速 {n(drive.avg_speed, 0)} km/h
                      </div>
                    </td>
                    <td className="num px-4 py-2.5 text-right text-[13px]">{km(drive.distance_km)}</td>
                    <td className="num px-4 py-2.5 text-right text-[13px] text-muted">
                      {duration(drive.duration_min)}
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

        <div className="space-y-3.5">
          <Panel title="电池健康" hint="估算">
            <div className="px-4 py-4">
              <div className="flex items-baseline gap-2">
                <span className="num text-[30px] font-semibold leading-none">
                  {pct(data.battery.health_pct, 1)}
                </span>
                <span className="text-[12px] text-muted">
                  相对 {n(data.battery.nominal_kwh, 1)} kWh
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#1b232d]">
                <div
                  className="h-full rounded-full bg-info"
                  style={{ width: `${Math.min(data.battery.health_pct ?? 0, 100)}%` }}
                />
              </div>
              <div className="mt-3 flex justify-between text-[11px] text-dim">
                <span>满电续航 {data.battery.range_km ? `${n(data.battery.range_km, 0)} km` : "—"}</span>
                <span>{data.battery.capacity_samples} 个样本</span>
              </div>
            </div>
          </Panel>

          <Panel
            title="最近充电"
            action={
              <button
                onClick={() => onNavigate("charging")}
                className="text-[11px] text-muted transition-colors hover:text-ink"
              >
                全部 →
              </button>
            }
          >
            {data.recent_charges.length === 0 ? (
              <Empty>还没有充电记录</Empty>
            ) : (
              <div>
                {data.recent_charges.map((charge) => (
                  <div
                    key={charge.id}
                    className="flex items-center gap-2.5 border-b border-[#131a22] px-4 py-2.5 last:border-0"
                  >
                    <span
                      className="h-6 w-1.5 shrink-0 rounded-full"
                      style={{ background: charge.is_fast ? "#d29922" : "#3fb950" }}
                    />
                    <div className="min-w-0">
                      <div className="text-[12px] text-muted">{dateTime(charge.started_at)}</div>
                      <div className="truncate text-[12px]">
                        {charge.address} · {charge.is_fast ? "快充" : "慢充"}
                      </div>
                    </div>
                    <div className="ml-auto text-right">
                      <div className="num text-[13px] font-medium">{n(charge.kwh, 1)}</div>
                      <div className="text-[10px] text-dim">
                        {timeOfDay(charge.started_at)} · {charge.start_soc}→{charge.end_soc}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
