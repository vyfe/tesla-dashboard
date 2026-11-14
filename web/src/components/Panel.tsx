import type { ReactNode } from "react";

interface PanelProps {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({ title, hint, action, children, className = "", bodyClassName = "" }: PanelProps) {
  return (
    <section className={`overflow-hidden rounded-xl border border-line bg-panel ${className}`}>
      <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {hint && <span className="ml-auto text-[11px] text-dim">{hint}</span>}
        {action && <span className={hint ? "" : "ml-auto"}>{action}</span>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

interface KpiProps {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: "default" | "good" | "warn";
}

export function Kpi({ label, value, unit, hint, tone = "default" }: KpiProps) {
  const valueTone =
    tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3.5">
      <div className="text-[11px] font-medium text-dim">{label}</div>
      <div className={`num mt-1.5 text-[28px] font-semibold leading-none ${valueTone}`}>
        {value}
        {unit && <span className="ml-1 font-sans text-[12px] font-normal text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-1.5 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

export function Empty({ children = "暂无数据" }: { children?: ReactNode }) {
  return (
    <div className="flex h-32 items-center justify-center px-4 text-center text-[13px] text-dim">
      {children}
    </div>
  );
}

export function Loading({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="space-y-3 p-4" aria-label={label} role="status">
      <div className="skeleton h-4 w-1/3 rounded" />
      <div className="skeleton h-3 w-2/3 rounded" />
      <div className="skeleton h-3 w-1/2 rounded" />
    </div>
  );
}

export function ErrorBox({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-accent" />
        <div className="text-[13px] font-medium">数据加载失败</div>
      </div>
      <p className="mt-2 text-[13px] text-muted">{message}</p>
      {hint && <p className="mt-3 text-[12px] leading-relaxed text-dim">{hint}</p>}
    </div>
  );
}
