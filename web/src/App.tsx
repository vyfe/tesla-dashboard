import { useEffect, useState } from "react";
import { api, IS_DEMO } from "./api";
import type { Meta } from "./types";
import { Shell, type Tab } from "./components/Shell";
import { ErrorBox, Loading } from "./components/Panel";
import { Overview } from "./pages/Overview";
import { Drives } from "./pages/Drives";
import { Battery } from "./pages/Battery";
import { Charging } from "./pages/Charging";

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [carId, setCarId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    const hash = window.location.hash.replace("#", "");
    return (["overview", "drives", "battery", "charging"] as Tab[]).includes(hash as Tab)
      ? (hash as Tab)
      : "overview";
  });

  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  useEffect(() => {
    let alive = true;
    api
      .meta()
      .then((value) => {
        if (!alive) return;
        setMeta(value);
        setCarId(value.cars[0]?.id ?? null);
      })
      .catch((err) => alive && setError(err.message ?? String(err)));
    return () => {
      alive = false;
    };
  }, []);

  const car = meta?.cars.find((item) => item.id === carId) ?? meta?.cars[0] ?? null;
  const tagline = meta?.demo_scenarios?.find((item) => item.id === car?.id)?.tagline;

  if (error) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-16">
        <ErrorBox
          message={error}
          hint="1) 检查 .env 里的 DATABASE_URL 是否指向 TeslaMate 的 PostgreSQL；2) 确认该账号有 SELECT 权限；3) 看 dashboard 容器日志 docker logs -f tesla-dashboard。"
        />
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="mx-auto max-w-[1180px] px-6 py-20">
        <Loading label={IS_DEMO ? "正在生成示例数据…" : "正在连接 TeslaMate 数据库…"} />
      </div>
    );
  }

  return (
    <Shell
      car={car}
      cars={meta.cars}
      onSelectCar={setCarId}
      tagline={tagline}
      tab={tab}
      onTab={setTab}
    >
      {tab === "overview" && <Overview key={car?.id} carId={car?.id} onNavigate={setTab} />}
      {tab === "drives" && <Drives key={car?.id} carId={car?.id} />}
      {tab === "battery" && <Battery key={car?.id} carId={car?.id} />}
      {tab === "charging" && <Charging key={car?.id} carId={car?.id} />}
    </Shell>
  );
}
