import { Panel } from "./Panel";
import { n } from "../lib/format";

interface Props {
  daily: { date: string; km: number }[];
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function heatClass(km: number): string {
  if (km <= 0) return "heat-0";
  if (km < 10) return "heat-1";
  if (km < 25) return "heat-2";
  if (km < 40) return "heat-3";
  return "heat-4";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel px-3 py-2.5">
      <div className="text-[10px] text-dim">{label}</div>
      <div className="num mt-0.5 text-[13px] font-medium">{value}</div>
    </div>
  );
}

export function CalendarHeatmap({ daily }: Props) {
  const byDay = new Map(daily.map((item) => [item.date, item.km]));
  const today = startOfDay(new Date());
  const anchor = addDays(today, -28);
  // 周一作为一周的开始
  const offset = (anchor.getDay() + 6) % 7;
  const start = addDays(anchor, -offset);
  const cells = Array.from({ length: 35 }, (_, index) => addDays(start, index));

  const values = cells.map((date) => (date > today ? 0 : byDay.get(dayKey(date)) ?? 0));
  const total = values.reduce((sum, km) => sum + km, 0);
  const activeDays = values.filter((km) => km > 0).length;
  const best = Math.max(...values, 0);
  const range = `${start.getMonth() + 1}/${start.getDate()} – ${today.getMonth() + 1}/${today.getDate()}`;

  return (
    <Panel title="里程日历" hint={`${activeDays} 天有行程`}>
      <div className="px-4 pb-3 pt-3.5">
        <div className="mx-auto max-w-[280px]">
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday} className="pb-0.5 text-center text-[10px] text-dim">
                {weekday}
              </div>
            ))}
            {cells.map((date, index) => {
              const key = dayKey(date);
              const km = values[index];
              const future = date.getTime() > today.getTime();
              const isToday = date.getTime() === today.getTime();
              return (
                <div
                  key={key}
                  title={
                    future
                      ? `${date.getMonth() + 1} 月 ${date.getDate()} 日`
                      : `${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${n(km, 1)} km`
                  }
                  className={[
                    "aspect-square rounded-[3px] transition-transform duration-150",
                    future ? "opacity-25" : "hover:scale-110",
                    heatClass(km),
                    isToday ? "ring-1 ring-accent ring-offset-0" : "",
                  ].join(" ")}
                />
              );
            })}
          </div>

          <div className="mt-2.5 flex items-center justify-between text-[10px] text-dim">
            <span>{range}</span>
            <span className="flex items-center gap-1">
              少
              {[1, 2, 3, 4].map((level) => (
                <i key={level} className={`h-2.5 w-2.5 rounded-[2px] heat-${level}`} />
              ))}
              多
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px border-t border-line-soft bg-line-soft">
        <Stat label="近 5 周" value={`${n(total, 0)} km`} />
        <Stat label="有行程" value={`${activeDays} 天`} />
        <Stat label="单日最多" value={`${n(best, 1)} km`} />
      </div>
    </Panel>
  );
}
