import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import type { ChargesPage } from "../types";
import { Empty, ErrorBox, Kpi, Loading, Panel } from "../components/Panel";
import { AXIS_PROPS, GRID_PROPS, TooltipBox } from "../components/chart";
import { dateTime, duration, monthLabel, n, pct } from "../lib/format";

const PAGE_SIZE = 30;

export function Charging({ carId }: { carId?: number }) {
  const [data, setData] = useState<ChargesPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .charges({ car: carId, limit: PAGE_SIZE, offset })
      .then((page) => {
        if (!alive) return;
        setData(page);
        setError(null);
      })
      .catch((err) => alive && setError(err.message ?? String(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [carId, offset]);

  if (error) return <ErrorBox message={error} />;
  if (!data && loading) return <Loading />;
  if (!data) return <Empty />;

  const monthly = data.monthly.map((item) => ({ ...item, label: monthLabel(item.month) }));
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const recentKwh = data.monthly.slice(-12).reduce((sum, item) => sum + item.kwh, 0);

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="累计充电" value={n(data.total)} unit="次" hint={`共 ${n(data.monthly.length)} 个月有记录`} />
        <Kpi label="近 12 月充入" value={n(recentKwh, 0)} unit="kWh" />
        <Kpi label="快充占比" value={pct(data.fast_share, 0)} hint="按全部充电次数统计" />
        <Kpi label="单次平均" value={n(data.avg_kwh, 1)} unit="kWh" hint={`累计 ${n(data.total_kwh, 0)} kWh`} />
      </div>

      <Panel title="月度充入电量" hint="kWh">
        {monthly.length === 0 ? (
          <Empty>暂无充电记录</Empty>
        ) : (
          <div className="h-[210px] px-2 pb-3 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 4, right: 14, bottom: 0, left: 2 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" minTickGap={20} {...AXIS_PROPS} />
                <YAxis width={48} {...AXIS_PROPS} />
                <Tooltip
                  cursor={{ fill: "#141b23" }}
                  content={({ active, payload, label }: any) =>
                    active && payload?.length ? (
                      <TooltipBox
                        label={`${label} · ${payload[0].payload.n} 次`}
                        rows={[
                          { name: "充入", value: n(payload[0].value, 1), unit: "kWh", color: "#e82127" },
                          { name: "费用", value: `¥${n(payload[0].payload.cost, 0)}`, color: "#3fb950" },
                        ]}
                      />
                    ) : null
                  }
                />
                <Bar dataKey="kwh" fill="#e82127" radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel title="充电记录" hint={`共 ${n(data.total)} 条`}>
        {loading && <Loading />}
        {!loading && data.items.length === 0 && <Empty>暂无充电记录</Empty>}
        {!loading && data.items.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line-soft">
                {["开始时间", "地点", "电量", "时长", "功率", "SOC", "费用"].map((head, index) => (
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
              {data.items.map((charge) => (
                <tr key={charge.id} className="border-b border-[#131a22] last:border-0 hover:bg-[#0f151c]">
                  <td className="whitespace-nowrap px-4 py-2.5 text-[13px] text-muted">
                    {dateTime(charge.started_at)}
                  </td>
                  <td className="px-4 py-2.5 text-[13px]">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: charge.is_fast ? "#d29922" : "#3fb950" }}
                      />
                      <span className="max-w-[180px] truncate">{charge.address}</span>
                      <span className="text-[10px] text-dim">{charge.is_fast ? "快充" : "慢充"}</span>
                    </span>
                  </td>
                  <td className="num px-4 py-2.5 text-right text-[13px]">{n(charge.kwh, 1)}</td>
                  <td className="num px-4 py-2.5 text-right text-[13px] text-muted">
                    {duration(charge.duration_min)}
                  </td>
                  <td className="num px-4 py-2.5 text-right text-[13px] text-muted">
                    {charge.power ? `${n(charge.power, 0)} kW` : "—"}
                  </td>
                  <td className="num px-4 py-2.5 text-right text-[13px] text-muted">
                    {charge.start_soc ?? "—"} → {charge.end_soc ?? "—"}%
                  </td>
                  <td className="num px-4 py-2.5 text-right text-[13px] text-muted">
                    {charge.cost ? `¥${n(charge.cost, 1)}` : "—"}
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
            disabled={offset + PAGE_SIZE >= data.total}
            onClick={() => setOffset((value) => value + PAGE_SIZE)}
            className="rounded-lg border border-line px-3 py-1.5 transition-colors disabled:opacity-35 hover:text-ink"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
