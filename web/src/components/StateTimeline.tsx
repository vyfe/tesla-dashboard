import { Empty, Panel } from "./Panel";
import { n } from "../lib/format";
import type { TimelineData } from "../types";

interface Props {
  data: TimelineData | null;
  error?: boolean;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const DAY_MS = 86_400_000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

interface Segment {
  left: number;
  width: number;
  label: string;
}

function clip(
  start: string,
  end: string | null,
  dayStart: Date,
  dayEnd: Date,
): Segment | null {
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : dayEnd.getTime();
  const clippedFrom = Math.max(from, dayStart.getTime());
  const clippedTo = Math.min(to, dayEnd.getTime());
  if (clippedTo <= clippedFrom) return null;
  return {
    left: ((clippedFrom - dayStart.getTime()) / DAY_MS) * 100,
    width: ((clippedTo - clippedFrom) / DAY_MS) * 100,
    label: `${clock(new Date(clippedFrom))}–${clock(new Date(clippedTo))}`,
  };
}

/** TeslaMate 的 states 命名：online / asleep / offline / updating，未知的按静置处理。 */
function stateTone(state: string): string {
  if (state === "online" || state === "updating") return "bg-muted/25";
  if (state === "driving") return "bg-drive/40";
  if (state === "charging") return "bg-charge/40";
  return "";
}

function stateLabel(state: string): string {
  if (state === "online") return "在线";
  if (state === "asleep") return "睡眠";
  if (state === "offline") return "离线";
  if (state === "updating") return "升级";
  if (state === "driving") return "行驶";
  if (state === "charging") return "充电";
  return state;
}

export function StateTimeline({ data, error = false }: Props) {
  if (!data) {
    return (
      <Panel title="近 7 天状态">
        {error ? (
          <Empty>时间线加载失败，刷新页面重试</Empty>
        ) : (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="skeleton h-4 rounded" />
            ))}
          </div>
        )}
      </Panel>
    );
  }

  const today = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6));
  const empty =
    data.drives.length === 0 && data.charges.length === 0 && (data.states?.length ?? 0) === 0;
  const chargedKwh = data.charges.reduce((sum, item) => sum + (item.kwh ?? 0), 0);

  return (
    <Panel
      title="近 7 天状态"
      className="flex flex-col"
      bodyClassName="flex flex-1 flex-col"
      hint={
        <span className="flex items-center gap-2.5">
          <span className="flex items-center gap-1"><i className="h-1.5 w-3 rounded-full bg-drive" />行驶</span>
          <span className="flex items-center gap-1"><i className="h-1.5 w-3 rounded-full bg-charge" />充电</span>
          {data.states_available && (
            <span className="flex items-center gap-1"><i className="h-1.5 w-3 rounded-full bg-muted/40" />在线</span>
          )}
        </span>
      }
    >
      {empty ? (
        <Empty>这段时间没有行驶或充电记录</Empty>
      ) : (
        <div className="flex-1 px-4 pb-3 pt-3.5">
          <div className="space-y-1.5">
            {days.map((day) => {
              const dayStart = day;
              const dayEnd = addDays(day, 1);
              const drives = data.drives.flatMap((item) => {
                const segment = clip(item.start, item.end, dayStart, dayEnd);
                return segment ? [{ ...segment, item }] : [];
              });
              const charges = data.charges.flatMap((item) => {
                const segment = clip(item.start, item.end, dayStart, dayEnd);
                return segment ? [{ ...segment, item }] : [];
              });
              const states = (data.states ?? []).flatMap((item) => {
                const segment = clip(item.start, item.end, dayStart, dayEnd);
                return segment ? [{ ...segment, item }] : [];
              });

              return (
                <div key={day.toISOString()} className="flex items-center gap-2">
                  <div className="w-[52px] shrink-0 text-[10px] leading-tight text-dim">
                    <div>周{WEEKDAYS[day.getDay()]}</div>
                    <div className="num text-[9px]">
                      {day.getMonth() + 1}-{String(day.getDate()).padStart(2, "0")}
                    </div>
                  </div>
                  <div className="relative h-4 flex-1 overflow-hidden rounded-[3px] bg-panel-2">
                    {states.map((segment, index) => (
                      <span
                        key={`s-${index}`}
                        className={`absolute inset-y-0 ${stateTone(segment.item.state)}`}
                        style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
                        title={`${stateLabel(segment.item.state)} ${segment.label}`}
                      />
                    ))}
                    {drives.map((segment, index) => (
                      <span
                        key={`d-${index}`}
                        className="absolute top-[4px] h-2 rounded-[2px] bg-drive"
                        style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
                        title={`行驶 ${segment.label} · ${n(segment.item.distance_km, 1)} km`}
                      />
                    ))}
                    {charges.map((segment, index) => (
                      <span
                        key={`c-${index}`}
                        className="absolute top-[4px] h-2 rounded-[2px] bg-charge"
                        style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
                        title={`充电 ${segment.label} · ${n(segment.item.kwh, 1)} kWh`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-1.5 flex justify-between pl-[60px] text-[9px] text-dim">
            {["00", "06", "12", "18", "24"].map((hour) => (
              <span key={hour}>{hour}</span>
            ))}
          </div>

          {!data.states_available && (
            <p className="mt-2 text-[10px] leading-relaxed text-dim">
              未授权 states 表，只显示行驶与充电。授权后可以看到在线 / 睡眠时段。
            </p>
          )}
        </div>
      )}

      {!empty && (
        <div className="mt-auto flex flex-wrap items-center gap-x-4 border-t border-line-soft px-4 py-2.5 text-[10px] text-dim">
          <span>近 7 天行驶 {data.drives.length} 次</span>
          <span>
            充电 {data.charges.length} 次
            {chargedKwh > 0 ? ` · ${n(chargedKwh, 1)} kWh` : ""}
          </span>
        </div>
      )}
    </Panel>
  );
}
