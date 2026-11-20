import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
import type { DriveDetail } from "../types";
import { DriveMap } from "./DriveMap";
import { Empty, ErrorBox, Loading } from "./Panel";
import { TooltipBox, useChartTheme } from "./chart";
import { useChartColors } from "../lib/theme";
import { dateTime, duration, km, kwh, n, timeOfDay, temp, consumption } from "../lib/format";

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

interface DriveModalProps {
  id: number;
  carId?: number;
  onClose: () => void;
  /** 弹框右上角的额外入口，比如从总览跳到「行程」页看全部记录。 */
  onViewAll?: () => void;
}

/**
 * 行程详情弹框：轨迹地图 + 速度 / 功率曲线 + 电量曲线。
 *
 * 总览页的「最近行程」和行程页的「行程明细」共用这一个组件，
 * 两边点行程的效果完全一致。
 */
export function DriveModal({ id, carId, onClose, onViewAll }: DriveModalProps) {
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

  // 弹框铺满视口后，背景页面跟着一起滚会很别扭，锁掉背景滚动。
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // 必须挂到 body 上：页面容器 main 带 fade-up 动画，动画结束后它的 transform
  // 仍是 matrix(1,0,0,1,0,0)（不是 none），会给 position:fixed 的后代建立
  // 包含块——弹框就会相对 main 定位，遮罩盖不满视口、弹框也被顶到页面中间。
  // 走 portal 挂到 body，fixed 就重新相对视口。
  return createPortal(
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
                  {detail.drive.consumption ? ` · ${consumption(detail.drive.consumption)}` : ""}
                </>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {onViewAll && (
              <button
                type="button"
                onClick={onViewAll}
                className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:bg-hover hover:text-ink"
              >
                全部行程 →
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:bg-hover hover:text-ink"
            >
              关闭
            </button>
          </div>
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
                  ["车外温度", temp(detail.drive.outside_temp)],
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
    </div>,
    document.body,
  );
}
