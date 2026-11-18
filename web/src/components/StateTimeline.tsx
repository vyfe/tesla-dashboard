import { Empty, Panel } from "./Panel";
import { HoverMap } from "./MiniMap";
import { n, stopDuration, timeOfDay, km } from "../lib/format";
import type { TimelineCharge, TimelineData, TimelineStop } from "../types";

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

/** 一段时间轴上的片段：行驶 / 停留 / 充电，三者互斥、按时间首尾相接。 */
type Kind = "drive" | "stop" | "charge";

interface Interval {
  from: number;
  to: number;
  kind: Kind;
  drive?: TimelineData["drives"][number];
  charge?: TimelineCharge;
  stop?: TimelineStop;
}

interface Segment extends Interval {
  left: number;
  width: number;
  /** 片段来源，用来把被边界切开��同一事件接回去 */
  source: Interval;
}

/**
 * 把一天的行驶 / 停留 / 充电切成一串互不重叠的片段。
 * 同一时刻可能同时命中充电和停留（充电时车是停着的），按「充电 > 行驶 > 停留」取优先级。
 */
function buildSegments(
  dayStart: Date,
  dayEnd: Date,
  drives: TimelineData["drives"],
  charges: TimelineCharge[],
  stops: TimelineStop[],
): Segment[] {
  const t0 = dayStart.getTime();
  const t1 = dayEnd.getTime();
  const events: Interval[] = [];

  for (const drive of drives) {
    const from = Math.max(t0, new Date(drive.start).getTime());
    const to = Math.min(t1, drive.end ? new Date(drive.end).getTime() : t1);
    if (to > from) events.push({ from, to, kind: "drive", drive });
  }
  for (const charge of charges) {
    const from = Math.max(t0, new Date(charge.start).getTime());
    const to = Math.min(t1, charge.end ? new Date(charge.end).getTime() : t1);
    if (to > from) events.push({ from, to, kind: "charge", charge });
  }
  for (const stop of stops) {
    const from = Math.max(t0, new Date(stop.start).getTime());
    const to = Math.min(t1, stop.end ? new Date(stop.end).getTime() : t1);
    if (to > from) events.push({ from, to, kind: "stop", stop });
  }

  const bounds = new Set<number>([t0, t1]);
  for (const event of events) {
    bounds.add(event.from);
    bounds.add(event.to);
  }
  const points = [...bounds].sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    if (to <= from) continue;
    const mid = (from + to) / 2;
    const hit =
      events.find((e) => e.kind === "charge" && mid >= e.from && mid < e.to) ??
      events.find((e) => e.kind === "drive" && mid >= e.from && mid < e.to) ??
      events.find((e) => e.kind === "stop" && mid >= e.from && mid < e.to);
    if (!hit) continue;
    const last = segments[segments.length - 1];
    // 同一个事件被边界切开时接回去，别在中间留缝
    if (last && last.kind === hit.kind && last.source === hit) {
      last.to = to;
      last.width = ((last.to - last.from) / DAY_MS) * 100;
      continue;
    }
    segments.push({
      ...hit,
      from,
      to,
      source: hit,
      left: ((from - t0) / DAY_MS) * 100,
      width: ((to - from) / DAY_MS) * 100,
    });
  }
  return segments;
}

/** 行驶片段：起终点 + 里程，鼠标指上去看。 */
function DriveSegment({ segment }: { segment: Segment }) {
  const drive = segment.drive;
  if (!drive) return null;
  const from = drive.from ?? "起点";
  const to = drive.to ?? "终点";
  return (
    <span
      className="absolute inset-y-0 bg-drive"
      style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
      title={`行驶 ${from} → ${to} · ${timeOfDay(drive.start)}–${timeOfDay(drive.end ?? drive.start)} · ${km(drive.distance_km)}`}
    />
  );
}

/** 停留片段：地点和时长指上去才展开，鼠标停住还会弹一张小地图。 */
function StopSegment({ segment }: { segment: Segment }) {
  const stop = segment.stop;
  if (!stop) return null;
  const label = stop.name ?? "未命名地点";
  return (
    <HoverMap
      lat={stop.lat}
      lng={stop.lng}
      title={label}
      subtitle={`停留 ${stopDuration(stop.minutes)} · ${timeOfDay(stop.start)}–${timeOfDay(stop.end ?? stop.start)}`}
    >
      <span
        className="absolute inset-y-0 bg-muted/25 hover:bg-muted/40"
        style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
        title={`停留 ${label} · ${stopDuration(stop.minutes)}`}
      />
    </HoverMap>
  );
}

/** 充电片段：地点、充电量，附小地图。 */
function ChargeSegment({ segment }: { segment: Segment }) {
  const charge = segment.charge;
  if (!charge) return null;
  const label = charge.name ?? "充电点";
  return (
    <HoverMap
      lat={charge.lat}
      lng={charge.lng}
      title={label}
      subtitle={`充电 ${n(charge.kwh, 1)} kWh · ${timeOfDay(charge.start)}–${timeOfDay(charge.end ?? charge.start)}`}
    >
      <span
        className="absolute inset-y-0 bg-charge"
        style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
        title={`充电 ${label} · ${n(charge.kwh, 1)} kWh`}
      />
    </HoverMap>
  );
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
  const empty = data.drives.length === 0 && data.charges.length === 0 && data.stops.length === 0;
  const chargedKwh = data.charges.reduce((sum, item) => sum + (item.kwh ?? 0), 0);
  const stoppedMinutes = data.stops.reduce((sum, item) => sum + (item.minutes ?? 0), 0);

  return (
    <Panel
      title="近 7 天状态"
      className="flex flex-col"
      bodyClassName="flex flex-1 flex-col"
      hint={
        <span className="flex items-center gap-2.5">
          <span className="flex items-center gap-1"><i className="h-1.5 w-3 rounded-full bg-drive" />行驶</span>
          <span className="flex items-center gap-1"><i className="h-1.5 w-3 rounded-full bg-muted/40" />停留</span>
          <span className="flex items-center gap-1"><i className="h-1.5 w-3 rounded-full bg-charge" />充电</span>
        </span>
      }
    >
      {empty ? (
        <Empty>这段时间没有行驶或充电记录</Empty>
      ) : (
        <div className="flex-1 px-4 pb-3 pt-3.5">
          <div className="space-y-2">
            {days.map((day) => {
              const dayStart = day;
              const dayEnd = addDays(day, 1);
              const segments = buildSegments(
                dayStart,
                dayEnd,
                data.drives,
                data.charges,
                data.stops
              );
              return (
                <div key={day.toISOString()} className="flex items-center gap-2">
                  <div className="w-[52px] shrink-0 pt-0.5 text-[10px] leading-tight text-dim">
                    <div>周{WEEKDAYS[day.getDay()]}</div>
                    <div className="num text-[9px]">
                      {day.getMonth() + 1}-{String(day.getDate()).padStart(2, "0")}
                    </div>
                  </div>
                  <div className="relative h-3.5 flex-1 overflow-hidden rounded-[3px] bg-panel-2">
                    {segments.map((segment, index) => {
                      if (segment.kind === "drive") return <DriveSegment key={index} segment={segment} />;
                      if (segment.kind === "charge") return <ChargeSegment key={index} segment={segment} />;
                      return <StopSegment key={index} segment={segment} />;
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex justify-between pl-[60px] text-[9px] text-dim">
            {["00", "06", "12", "18", "24"].map((hour) => (
              <span key={hour}>{hour}</span>
            ))}
          </div>
        </div>
      )}

      {!empty && (
        <div className="mt-auto flex flex-wrap items-center gap-x-4 border-t border-line-soft px-4 py-2.5 text-[10px] text-dim">
          <span>行驶 {data.drives.length} 次</span>
          <span>
            充电 {data.charges.length} 次
            {chargedKwh > 0 ? ` · ${n(chargedKwh, 1)} kWh` : ""}
          </span>
          <span>
            停留 {data.stops.length} 处
            {data.stops.length > 0 ? ` · 合计 ${stopDuration(stoppedMinutes)}` : ""}
          </span>
        </div>
      )}
    </Panel>
  );
}
