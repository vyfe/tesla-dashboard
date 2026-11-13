/** 图表共用样式：统一坐标轴、网格、tooltip 的观感。 */

export const AXIS_TICK = { fill: "#5c6672", fontSize: 11 };
export const AXIS_PROPS = {
  tick: AXIS_TICK,
  axisLine: false,
  tickLine: false,
} as const;

export const GRID_PROPS = {
  stroke: "#161d26",
  vertical: false,
} as const;

interface TooltipRow {
  name?: string;
  value?: number | string;
  unit?: string;
  color?: string;
}

export function TooltipBox({
  label,
  rows,
}: {
  label?: string;
  rows: TooltipRow[];
}) {
  return (
    <div className="min-w-[120px] rounded-lg border border-[#25303d] bg-[#0d1218]/95 px-3 py-2 shadow-xl backdrop-blur">
      {label && <div className="mb-1 text-[11px] text-dim">{label}</div>}
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2 text-[12px]">
          {row.color && (
            <span className="h-2 w-2 rounded-sm" style={{ background: row.color }} />
          )}
          <span className="text-muted">{row.name}</span>
          <span className="num ml-auto font-medium text-ink">
            {row.value}
            {row.unit && <span className="ml-0.5 text-[10px] font-normal text-dim">{row.unit}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
