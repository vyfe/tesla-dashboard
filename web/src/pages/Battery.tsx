import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import type { Battery as BatteryData } from "../types";
import { Empty, ErrorBox, Kpi, Loading, Panel } from "../components/Panel";
import { AXIS_PROPS, GRID_PROPS, TooltipBox } from "../components/chart";
import { monthLabel, n, niceScale, pct } from "../lib/format";

function CapacityTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload ?? {};
  return (
    <TooltipBox
      label={`${label} · ${point.n} 个样本`}
      rows={[{ name: "估算容量", value: n(point.kwh, 2), unit: "kWh", color: "#58a6ff" }]}
    />
  );
}

function RangeTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload ?? {};
  return (
    <TooltipBox
      label={`${label} · ${point.n} 个样本`}
      rows={[{ name: "满电续航", value: n(point.value, 0), unit: "km", color: "#3fb950" }]}
    />
  );
}

export function Battery({ carId }: { carId?: number }) {
  const [data, setData] = useState<BatteryData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .battery(carId)
      .then((value) => alive && setData(value))
      .catch((err) => alive && setError(err.message ?? String(err)));
    return () => {
      alive = false;
    };
  }, [carId]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  const capacity = data.capacity_series.map((item) => ({ ...item, label: monthLabel(item.month) }));
  const range = data.range_series.map((item) => ({ ...item, label: monthLabel(item.month) }));
  const histogram = data.soc_histogram;
  const capacityScale = niceScale(capacity.map((item) => item.kwh));
  const rangeScale = niceScale(range.map((item) => item.value));

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="健康度"
          value={pct(data.health_pct, 1)}
          hint={`相对标称 ${n(data.nominal_kwh, 1)} kWh`}
          tone={data.health_pct && data.health_pct < 90 ? "warn" : "good"}
        />
        <Kpi label="估算容量" value={n(data.capacity_kwh, 1)} unit="kWh" hint={`${data.capacity_samples} 次充电推算`} />
        <Kpi label="满电续航" value={n(data.range_km, 0)} unit="km" hint="按 rated range 折算" />
        <Kpi label="快充占比" value={pct(data.fast_share, 0)} hint="按充电次数统计" />
      </div>

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Panel title="容量趋势" hint="按月取中位数">
          {capacity.length < 2 ? (
            <Empty>充电样本还不够，至少需要两个月的完整充电</Empty>
          ) : (
            <div className="h-[220px] px-2 pb-3 pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={capacity} margin={{ top: 6, right: 14, bottom: 0, left: 2 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="label" minTickGap={26} {...AXIS_PROPS} />
                  <YAxis width={48} domain={capacityScale.domain} ticks={capacityScale.ticks} allowDecimals={false} {...AXIS_PROPS} />
                  <Tooltip content={<CapacityTooltip />} cursor={{ stroke: "#2a3644" }} />
                  <Line
                    type="monotone"
                    dataKey="kwh"
                    stroke="#58a6ff"
                    strokeWidth={2}
                    dot={{ r: 2.5, fill: "#58a6ff", strokeWidth: 0 }} isAnimationActive={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="满电续航" hint="归一化到 100% SOC">
          {range.length < 2 ? (
            <Empty>样本不足</Empty>
          ) : (
            <div className="h-[220px] px-2 pb-3 pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={range} margin={{ top: 6, right: 14, bottom: 0, left: 2 }}>
                  <defs>
                    <linearGradient id="rangeFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3fb950" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#3fb950" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="label" minTickGap={26} {...AXIS_PROPS} />
                  <YAxis width={48} domain={rangeScale.domain} ticks={rangeScale.ticks} allowDecimals={false} {...AXIS_PROPS} />
                  <Tooltip content={<RangeTooltip />} cursor={{ stroke: "#2a3644" }} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#3fb950"
                    strokeWidth={2}
                    fill="url(#rangeFill)"
                    dot={false} isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[1fr_1fr]">
        <Panel title="充电起始电量分布" hint="看你的充电习惯">
          <div className="h-[190px] px-2 pb-3 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histogram} margin={{ top: 4, right: 14, bottom: 0, left: 2 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="bucket" {...AXIS_PROPS} />
                <YAxis width={44} allowDecimals={false} {...AXIS_PROPS} />
                <Tooltip
                  cursor={{ fill: "#141b23" }}
                  content={({ active, payload, label }: any) =>
                    active && payload?.length ? (
                      <TooltipBox
                        label={`SOC ${label}%`}
                        rows={[{ name: "充电次数", value: payload[0].value, unit: "次", color: "#e82127" }]}
                      />
                    ) : null
                  }
                />
                <Bar dataKey="n" fill="#e82127" radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="border-t border-line-soft px-4 py-2.5 text-[11px] leading-relaxed text-dim">
            多数人习惯把电用到 20–30% 才充；长期低于 10% 才补电对电池更不友好。
          </div>
        </Panel>

        <Panel title="数据口径" hint="重要">
          <div className="space-y-2.5 px-4 py-4 text-[12px] leading-relaxed text-muted">
            <p>
              <span className="text-ink">容量</span>：由每次充电的{" "}
              <code className="rounded bg-[#0d1218] px-1 py-0.5 text-[11px] text-info">
                charge_energy_added / (end_soc − start_soc)
              </code>{" "}
              推算，只取 SOC 跨度 ≥ 15% 且时长 ≥ 10 分钟的充电段。
            </p>
            <p>
              <span className="text-ink">续航</span>：用{" "}
              <code className="rounded bg-[#0d1218] px-1 py-0.5 text-[11px] text-info">
                end_rated_range_km / end_soc
              </code>{" "}
              归一化到 100%，只取结束 SOC ≥ 50% 的记录。
            </p>
            <p>
              <span className="text-ink">噪声</span>：直流快充发热会让充入电量偏大，估算值略高；
              因此图上按月取中位数，单次波动不代表真实衰减。
            </p>
            <p className="text-dim">
              当前样本：容量 {data.capacity_samples} 次 / 续航 {data.range_samples} 次。
              样本 &lt; 5 时结论不可靠。
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
