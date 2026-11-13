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
    <section
      className={`overflow-hidden rounded-[14px] border border-line bg-panel ${className}`}
    >
      <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3.5">
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
    <div className="rounded-[13px] border border-line bg-gradient-to-b from-[#121820] to-[#0f141a] px-4 py-3.5">
      <div className="text-[11px] uppercase tracking-[0.09em] text-dim">{label}</div>
      <div className={`num mt-1 text-[27px] font-semibold leading-tight ${valueTone}`}>
        {value}
        {unit && <span className="ml-1 text-[13px] font-normal text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

export function Empty({ children = "暂无数据" }: { children?: ReactNode }) {
  return (
    <div className="flex h-32 items-center justify-center text-[13px] text-dim">{children}</div>
  );
}

export function Loading({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="flex h-40 items-center justify-center gap-2 text-[13px] text-dim">
      <span className="h-3 w-3 animate-spin rounded-full border border-line border-t-muted" />
      {label}
    </div>
  );
}

export function ErrorBox({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="rounded-[14px] border border-[#3a1d1f] bg-[#1a1113] p-5">
      <div className="text-[13px] font-medium text-[#ff7b72]">数据加载失败</div>
      <p className="mt-1.5 text-[13px] text-muted">{message}</p>
      {hint && <p className="mt-3 text-[12px] leading-relaxed text-dim">{hint}</p>}
    </div>
  );
}
