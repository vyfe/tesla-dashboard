import { useState, type ReactNode } from "react";
import { IS_DEMO } from "../api";
import type { Car } from "../types";
import { VehicleStatusStrip } from "./VehicleStatusStrip";
import { ThemeToggle } from "./ThemeToggle";

export type Tab = "overview" | "drives" | "battery" | "charging";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "总览" },
  { key: "drives", label: "行程" },
  { key: "battery", label: "电池" },
  { key: "charging", label: "充电" },
];

interface ShellProps {
  car: Car | null;
  cars?: Car[];
  onSelectCar?: (id: number) => void;
  tagline?: string;
  tab: Tab;
  onTab: (tab: Tab) => void;
  children: ReactNode;
}

/** demo 模式顶部的提示条：标明数据是假的，并给出切换场景 / 复制链接的入口。 */
function DemoBanner({
  cars,
  car,
  onSelectCar,
  tagline,
}: {
  cars: Car[];
  car: Car | null;
  onSelectCar?: (id: number) => void;
  tagline?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/demo`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 剪贴板不可用（无 HTTPS / 权限被拒）时静默跳过 */
    }
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-panel px-3.5 py-2 text-[11px] text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-warn" />
        <span className="font-medium text-ink">示例数据</span>
      </span>
      <span className="text-dim">页面上的数字全部是生成的假数据，与任何真实车辆无关。</span>

      {tagline && <span className="text-dim">当前场景：{tagline}</span>}

      <div className="ml-auto flex items-center gap-2">
        {cars.length > 1 && onSelectCar && (
          <select
            value={car?.id ?? ""}
            onChange={(event) => onSelectCar(Number(event.target.value))}
            aria-label="切换示例车辆"
            className="rounded-[7px] border border-line bg-panel-2 px-2 py-1 text-[11px] text-ink"
          >
            {cars.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.model}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={copyLink}
          className="rounded-[7px] border border-line px-2 py-1 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          {copied ? "链接已复制" : "复制分享链接"}
        </button>
      </div>
    </div>
  );
}

export function Shell({
  car,
  cars = [],
  onSelectCar,
  tagline,
  tab,
  onTab,
  children,
}: ShellProps) {
  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-16 pt-6 sm:px-7">
      {IS_DEMO && (
        <DemoBanner cars={cars} car={car} onSelectCar={onSelectCar} tagline={tagline} />
      )}

      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-accent ring-4 ring-accent/10" />
          <span className="text-[15px] font-semibold tracking-tight">{car?.name ?? "我的特斯拉"}</span>
          <span className="text-[12px] text-muted">
            {[car?.model, car?.trim, car?.vin?.slice(-6)].filter(Boolean).join(" · ")}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <nav className="flex gap-1 rounded-[10px] border border-line bg-panel p-1" aria-label="页面">
              {TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onTab(item.key)}
                  aria-current={tab === item.key ? "page" : undefined}
                  className={
                    "rounded-[7px] px-3 py-1.5 text-[12px] transition-colors " +
                    (tab === item.key
                      ? "bg-panel-2 text-ink shadow-[inset_0_0_0_1px_var(--line)]"
                      : "text-muted hover:bg-hover hover:text-ink")
                  }
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        <VehicleStatusStrip carId={car?.id} />
      </header>

      <main key={tab} className="fade-up">
        {children}
      </main>

      <footer className="mt-8 text-center text-[10px] text-dim">
        {IS_DEMO
          ? "演示页面 · 全部数据为程序生成的示例数据"
          : "数据来源：teslamate 私有数据收集服务，不对外公开展示"}
      </footer>
    </div>
  );
}
