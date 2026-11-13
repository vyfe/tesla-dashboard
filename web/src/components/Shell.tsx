import type { ReactNode } from "react";
import type { Car } from "../types";

export type Tab = "overview" | "drives" | "battery" | "charging";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "总览" },
  { key: "drives", label: "行程" },
  { key: "battery", label: "电池" },
  { key: "charging", label: "充电" },
];

interface ShellProps {
  car: Car | null;
  tab: Tab;
  onTab: (tab: Tab) => void;
  children: ReactNode;
}

export function Shell({ car, tab, onTab, children }: ShellProps) {
  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-16 pt-6 sm:px-7">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <span className="h-2 w-2 rounded-full bg-good shadow-[0_0_0_4px_rgba(63,185,80,0.14)]" />
        <span className="text-[15px] font-semibold tracking-tight">{car?.name ?? "我的特斯拉"}</span>
        <span className="text-[13px] text-muted">
          {[car?.model, car?.trim, car?.vin?.slice(-6)].filter(Boolean).join(" · ")}
        </span>
        <nav className="ml-auto flex gap-1 rounded-[10px] border border-line bg-panel-2 p-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              onClick={() => onTab(item.key)}
              className={
                "rounded-[7px] px-3.5 py-1.5 text-[13px] transition-colors " +
                (tab === item.key
                  ? "bg-[#1b232d] text-ink shadow-[inset_0_0_0_1px_#26313d]"
                  : "text-muted hover:text-ink")
              }
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="fade-up">{children}</main>
      <footer className="mt-8 text-center text-[11px] text-[#3d4550]">
        只读旁路服务 · 数据来自你自己的 TeslaMate PostgreSQL
      </footer>
    </div>
  );
}
