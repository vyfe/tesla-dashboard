import { useEffect, useState } from "react";
import { api } from "../api";
import type { Drive } from "../types";
import { DriveModal } from "../components/DriveModal";
import { Empty, ErrorBox, Loading, Panel } from "../components/Panel";
import { dateTime, duration, km, n, consumption } from "../lib/format";

const PAGE_SIZE = 25;

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
                  {["出发时间", "路线", "距离", "时长", "均速", "电耗"].map((head, index) => (
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
                      {consumption(drive.consumption)}
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
