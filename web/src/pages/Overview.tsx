import { useEffect, useState } from "react";
import { api } from "../api";
import type { Overview as OverviewData, TimelineData } from "../types";
import { Empty, ErrorBox, Loading, Panel } from "../components/Panel";
import { CalendarHeatmap } from "../components/CalendarHeatmap";
import { StateTimeline } from "../components/StateTimeline";
import { HoverMap } from "../components/MiniMap";
import { dateTime, delta, duration, km, n, pct, timeOfDay } from "../lib/format";
import type { Tab } from "../components/Shell";

interface Props {
  carId?: number;
  onNavigate: (tab: Tab) => void;
}

function LedgerCell({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="bg-panel px-4 py-3">
      <div className="text-[10px] text-dim">{label}</div>
      <div className="num mt-1 text-[20px] font-semibold leading-none">
        {value}
        {unit && <span className="ml-1 font-sans text-[10px] font-normal text-dim">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[10px] text-muted">{hint}</div>}
    </div>
  );
}

export function Overview({ carId, onNavigate }: Props) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [timelineError, setTimelineError] = useState(false);

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

  useEffect(() => {
    let alive = true;
    api
      .timeline(carId, 7)
      .then((value) => alive && setTimeline(value))
      .catch(() => {
        if (!alive) return;
        setTimelineError(true);
      });
    return () => {
      alive = false;
    };
  }, [carId]);

  if (error) return <ErrorBox message={error} hint="检查 api 容器的 DATABASE_URL 是否能连到 TeslaMate 的 PostgreSQL。" />;
  if (!data) return <Loading />;

  const { kpis, ledger, battery } = data;
  const change = delta(kpis.month_km, kpis.prev_month_km);
  const loss = ledger.grid_kwh !== null ? Math.max(ledger.grid_kwh - ledger.charged_kwh, 0) : null;
  const efficiency = ledger.efficiency_pct ?? 0;

  return (
    <div className="space-y-3.5">
      <div className="grid gap-3.5 lg:grid-cols-[1.55fr_1fr]">
        <Panel title="本月能量账本" hint={ledger.sessions ? `${ledger.sessions} 次充电` : "本月还没有充电"}>
          <div className="grid grid-cols-2 gap-px bg-line-soft sm:grid-cols-4">
            <LedgerCell
              label="充入"
              value={n(ledger.charged_kwh, 1)}
              unit="kWh"
              hint={ledger.grid_kwh ? `电网取用 ${n(ledger.grid_kwh, 1)}` : undefined}
            />
            <LedgerCell
              label="电费"
              value={`¥${n(ledger.cost, 1)}`}
              hint={ledger.cost_per_kwh ? `¥${n(ledger.cost_per_kwh, 2)} / kWh` : undefined}
            />
            <LedgerCell
              label="充电效率"
              value={ledger.efficiency_pct === null ? "—" : n(ledger.efficiency_pct, 1)}
              unit={ledger.efficiency_pct === null ? undefined : "%"}
              hint="充入 / 电网取用"
            />
            <LedgerCell
              label="行驶耗电"
              value={ledger.consumed_kwh === null ? "—" : n(ledger.consumed_kwh, 1)}
              unit={ledger.consumed_kwh === null ? undefined : "kWh"}
              hint={kpis.consumption ? `${n(kpis.consumption, 1)} kWh/100km` : "样本不足"}
            />
          </div>

          {ledger.grid_kwh !== null && ledger.charged_kwh > 0 && (
            <div className="px-4 pb-3 pt-3">
              <div className="flex h-1.5 overflow-hidden rounded-full bg-line-soft">
                <div
                  className="h-full rounded-full bg-charge transition-[width] duration-700"
                  style={{ width: `${Math.min(Math.max(efficiency, 0), 100)}%` }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] text-dim">
                <span>充入 {n(ledger.charged_kwh, 1)} kWh</span>
                <span>{loss !== null && loss > 0 ? `损耗 ${n(loss, 1)} kWh` : "无损耗数据"}</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft px-4 py-2.5 text-[11px] text-muted">
            <span>本月 {n(kpis.month_km, 1)} km</span>
            <span>{n(kpis.month_drives)} 次行程</span>
            <span>平均 {n(kpis.avg_trip_km, 1)} km/次</span>
            {change && <span className="text-dim">较上月 {change.text}</span>}
          </div>
        </Panel>

        <Panel title="电池健康" hint="估算">
          <div className="px-4 pb-4 pt-3.5">
            <div className="flex items-end justify-between">
              <div className={`num text-[34px] font-semibold leading-none ${battery.health_pct && battery.health_pct < 90 ? "text-warn" : ""}`}>
                {pct(battery.health_pct, 1)}
              </div>
              <span className="pb-1 text-[10px] text-dim">相对标称 {n(battery.nominal_kwh, 1)} kWh</span>
            </div>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line-soft">
              <div
                className="h-full rounded-full bg-good transition-[width] duration-700"
                style={{ width: `${Math.min(battery.health_pct ?? 0, 100)}%` }}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] text-dim">估算容量</div>
                <div className="num mt-0.5 text-[13px]">{n(battery.capacity_kwh, 1)} kWh</div>
              </div>
              <div>
                <div className="text-[10px] text-dim">满电续航</div>
                <div className="num mt-0.5 text-[13px]">{battery.range_km === null ? "—" : `${n(battery.range_km, 0)} km`}</div>
              </div>
            </div>

            <div className="mt-3 text-[10px] text-dim">{battery.capacity_samples} 个充电样本参与估算</div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[1fr_1.55fr]">
        <CalendarHeatmap daily={data.daily} />
        <StateTimeline data={timeline} error={timelineError} />
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[1.55fr_1fr]">
        <Panel
          title="最近行程"
          hint="点击「行程」查看曲线"
          action={
            <button
              type="button"
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[330px] border-collapse">
                <thead>
                  <tr className="border-b border-line-soft">
                    {["路线", "距离", "时长", "百公里电耗"].map((head, index) => (
                      <th
                        key={head}
                        className={`px-3 py-2 text-[10px] sm:px-4 font-medium text-dim ${
                          index === 0 ? "text-left" : "text-right"
                        } ${index === 3 ? "hidden sm:table-cell" : ""}`}
                      >
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.recent_drives.map((drive) => (
                    <tr key={drive.id} className="border-b border-line-soft last:border-0 hover:bg-hover">
                      <td className="px-3 py-2.5 sm:px-4">
                        <div className="flex items-center gap-1.5 text-[13px]">
                          <span className="max-w-[130px] truncate">{drive.from}</span>
                          <span className="text-[10px] text-dim">→</span>
                          <span className="max-w-[130px] truncate">{drive.to}</span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-dim">
                          {dateTime(drive.started_at)} · 均速 {n(drive.avg_speed, 0)} km/h
                          {drive.consumption ? (
                            <span className="sm:hidden"> · {n(drive.consumption, 1)} kWh/100km</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="num whitespace-nowrap px-3 py-2.5 text-right sm:px-4 text-[13px]">{km(drive.distance_km)}</td>
                      <td className="num whitespace-nowrap px-3 py-2.5 text-right sm:px-4 text-[13px] text-muted">
                        {duration(drive.duration_min)}
                      </td>
                      <td
                        className="num hidden whitespace-nowrap px-3 py-2.5 text-right text-[13px] text-muted sm:table-cell sm:px-4"
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

        <Panel
          title="最近充电"
          action={
            <button
              type="button"
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
                  className="flex items-center gap-2.5 border-b border-line-soft px-4 py-2.5 last:border-0"
                >
                  <span className={`h-6 w-1 shrink-0 rounded-full ${charge.is_fast ? "bg-charge" : "bg-good"}`} />
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted">{dateTime(charge.started_at)}</div>
                    <div className="truncate text-[12px]">
                      <HoverMap
                        lat={charge.lat}
                        lng={charge.lng}
                        title={charge.address}
                        subtitle={`充电 ${n(charge.kwh, 1)} kWh · ${dateTime(charge.started_at)}`}
                      >
                        <span className="underline decoration-dotted underline-offset-2">
                          {charge.address}
                        </span>
                      </HoverMap>{" "}
                      · {charge.is_fast ? "快充" : "慢充"}
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
              {ledger.sessions > 0 && (
                <div className="border-t border-line-soft px-4 py-2.5 text-[10px] text-dim">
                  本月 {ledger.sessions} 次 · {n(ledger.charged_kwh, 1)} kWh · ¥{n(ledger.cost, 1)}
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
