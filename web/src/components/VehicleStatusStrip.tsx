import { useEffect, useState } from "react";
import { api, IS_DEMO } from "../api";
import type { VehicleStatus as Status } from "../types";
import {n, distance, distanceUnit} from "../lib/format";

function ageLabel(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 2) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function levelClass(soc: number | null): string {
  if (soc === null) return "bg-line";
  if (soc <= 10) return "bg-accent";
  if (soc <= 20) return "bg-warn";
  return "bg-good";
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-[74px]">
      <div className="text-[10px] text-dim">{label}</div>
      <div className="num mt-0.5 text-[15px] font-medium leading-tight">
        {value}
        {unit && <span className="ml-0.5 font-sans text-[10px] font-normal text-dim">{unit}</span>}
      </div>
    </div>
  );
}

export function VehicleStatusStrip({ carId }: { carId?: number }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!carId) return;
    let alive = true;
    const load = () => {
      api
        .status(carId)
        .then((value) => {
          if (!alive) return;
          setStatus(value);
          setFailed(false);
        })
        .catch(() => alive && setFailed(true));
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [carId]);

  if (!status) {
    if (failed) {
      return (
        <section className="mt-3 rounded-xl border border-line bg-panel px-4 py-3 text-[12px] text-muted">
          状态暂时取不到，稍后自动重试。
        </section>
      );
    }
    return (
      <section className="mt-3 flex items-center gap-4 rounded-xl border border-line bg-panel px-4 py-3">
        <div className="skeleton h-5 w-11 rounded-[3px]" />
        <div className="skeleton h-5 w-16 rounded" />
        <div className="skeleton h-5 w-24 rounded" />
        <div className="ml-auto skeleton h-4 w-20 rounded" />
      </section>
    );
  }

  if (!status.available) {
    return (
      <section className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-panel px-4 py-3 text-[12px] text-muted">
        <span>{failed ? "状态暂时取不到" : "还没有位置数据"}</span>
        <span className="text-dim">TeslaMate 同步过行驶记录后这里会显示当前电量、续航和总里程。</span>
      </section>
    );
  }

  const soc = status.soc;
  return (
    <section className="mt-3 rounded-xl border border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2.5">
          <span
            className="relative h-5 w-11 rounded-[3px] border border-line p-[2px]"
            role="img"
            aria-label={`电量 ${soc ?? "未知"}%`}
          >
            <span
              className={`block h-full rounded-[1px] transition-[width] duration-700 ${levelClass(soc)}`}
              style={{ width: `${Math.min(Math.max(soc ?? 0, 0), 100)}%` }}
            />
          </span>
          <span className="num text-[22px] font-semibold leading-none">{soc === null ? "—" : n(soc)}</span>
          <span className="-ml-1 self-end pb-0.5 text-[11px] text-dim">%</span>
          {status.charging && (
            <span className="inline-flex items-center gap-1 rounded-full bg-charge/10 px-2 py-0.5 text-[10px] font-medium text-charge">
              <span className="h-1.5 w-1.5 rounded-full bg-charge" />
              充电中
            </span>
          )}
        </div>

        <div className="hidden h-8 w-px bg-line-soft sm:block" />

        <Stat
          label="剩余续航"
          value={status.range_km === null ? "—" : n(distance(status.range_km))}
          unit={distanceUnit()}
        />
        <Stat
          label="总里程"
          value={status.odometer_km === null ? "—" : n(distance(status.odometer_km))}
          unit={distanceUnit()}
        />
        <Stat label="最后更新" value={ageLabel(status.age_min)} />

        <span className="ml-auto self-end text-[10px] text-dim">
          {IS_DEMO ? "示例状态" : "TeslaMate 最近一次上报"}
        </span>
      </div>
    </section>
  );
}
