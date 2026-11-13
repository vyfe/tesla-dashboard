import { useEffect, useState } from "react";
import { api } from "./api";
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
      .then((value) => alive && setMeta(value))
      .catch((err) => alive && setError(err.message ?? String(err)));
    return () => {
      alive = false;
    };
  }, []);

  const car = meta?.cars[0] ?? null;

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
        <Loading label="正在连接 TeslaMate 数据库…" />
      </div>
    );
  }

  return (
    <Shell car={car} tab={tab} onTab={setTab}>
      {tab === "overview" && <Overview carId={car?.id} onNavigate={setTab} />}
      {tab === "drives" && <Drives carId={car?.id} />}
      {tab === "battery" && <Battery carId={car?.id} />}
      {tab === "charging" && <Charging carId={car?.id} />}
    </Shell>
  );
}
