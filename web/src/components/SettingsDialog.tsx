import { useEffect, useState } from "react";
import { api } from "../api";
import { DEFAULT_SETTINGS, setSettings, type Settings } from "../lib/settings";
import { ErrorBox, Loading } from "./Panel";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Language {
  code: string;
  label: string;
}

const LENGTH_OPTIONS = [
  { value: "km", label: "公里 km" },
  { value: "mi", label: "英里 mi" },
];

const TEMPERATURE_OPTIONS = [
  { value: "C", label: "摄氏度 °C" },
  { value: "F", label: "华氏度 °F" },
];

const RANGE_OPTIONS = [
  { value: "rated", label: "额定续航" },
  { value: "ideal", label: "理想续航" },
];

const PRESSURE_OPTIONS = [
  { value: "bar", label: "bar" },
  { value: "psi", label: "psi" },
];

const THEME_OPTIONS = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

function Choice({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-ink">{label}</div>
      {hint && <div className="mt-0.5 text-[10px] text-dim">{hint}</div>}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={
              "rounded-[7px] border px-2.5 py-1 text-[11px] transition-colors " +
              (value === option.value
                ? "border-line bg-panel-2 text-ink shadow-[inset_0_0_0_1px_var(--line)]"
                : "border-line-soft text-muted hover:bg-hover hover:text-ink")
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 显示设置面板。
 * 保存后写回 TeslaMate 的 settings 表，所以 TeslaMate 面板那边也会跟着变。
 */
export function SettingsDialog({ open, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(DEFAULT_SETTINGS);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [writable, setWritable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setSaved(false);
    api
      .settings()
      .then((value) => {
        if (!alive) return;
        setDraft({ ...DEFAULT_SETTINGS, ...value.settings });
        setLanguages(value.languages ?? []);
        setWritable(value.writable);
      })
      .catch((err) => alive && setError(err.message ?? String(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const patch = (next: Partial<Settings>) => {
    setSaved(false);
    setDraft((current) => ({ ...current, ...next }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const value = await api.saveSettings(draft);
      setSettings(value.settings);
      setDraft({ ...DEFAULT_SETTINGS, ...value.settings });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-line bg-panel shadow-[var(--shadow)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="显示设置"
      >
        <div className="flex items-center gap-3 border-b border-line-soft px-5 py-3.5">
          <div>
            <div className="text-[14px] font-medium">显示设置</div>
            <div className="mt-0.5 text-[10px] text-dim">
              {writable
                ? "保存后写回 TeslaMate 的 settings 表，两边保持一致"
                : "未配置写入账号，当前只能查看"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            关闭
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error && <ErrorBox message={error} />}
          {loading ? (
            <Loading />
          ) : (
            <>
              <Choice
                label="距离单位"
                value={draft.unit_of_length}
                options={LENGTH_OPTIONS}
                onChange={(value) => patch({ unit_of_length: value as Settings["unit_of_length"] })}
              />
              <Choice
                label="温度单位"
                value={draft.unit_of_temperature}
                options={TEMPERATURE_OPTIONS}
                onChange={(value) => patch({ unit_of_temperature: value as Settings["unit_of_temperature"] })}
              />
              <Choice
                label="续航口径"
                hint="影响「满电续航」的折算口径"
                value={draft.preferred_range}
                options={RANGE_OPTIONS}
                onChange={(value) => patch({ preferred_range: value as Settings["preferred_range"] })}
              />
              <Choice
                label="压力单位"
                hint="仅同步给 TeslaMate，看板暂未展示胎压"
                value={draft.unit_of_pressure}
                options={PRESSURE_OPTIONS}
                onChange={(value) => patch({ unit_of_pressure: value as Settings["unit_of_pressure"] })}
              />
              <Choice
                label="主题"
                hint="看板默认主题；页面右上角仍可临时切换"
                value={draft.theme_mode}
                options={THEME_OPTIONS}
                onChange={(value) => patch({ theme_mode: value as Settings["theme_mode"] })}
              />

              <div>
                <div className="text-[11px] font-medium text-ink">界面语言</div>
                <div className="mt-0.5 text-[10px] text-dim">仅影响 TeslaMate 面板，看板界面本身是中文</div>
                <select
                  value={draft.language}
                  onChange={(event) => patch({ language: event.target.value })}
                  className="mt-1.5 w-full rounded-[7px] border border-line bg-panel-2 px-2 py-1.5 text-[12px] text-ink"
                >
                  {languages.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border-t border-line-soft pt-3">
                <div className="text-[11px] font-medium text-ink">TeslaMate 面板链接</div>
                <div className="mt-0.5 text-[10px] text-dim">
                  写回 TeslaMate 面板里显示的跳转地址，不影响看板
                </div>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-[10px] text-dim">面板地址</span>
                    <input
                      value={draft.base_url}
                      onChange={(event) => patch({ base_url: event.target.value })}
                      placeholder="http://…"
                      className="mt-0.5 w-full rounded-[7px] border border-line bg-panel-2 px-2 py-1.5 text-[12px] text-ink"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-dim">Grafana 地址</span>
                    <input
                      value={draft.grafana_url}
                      onChange={(event) => patch({ grafana_url: event.target.value })}
                      placeholder="http://…"
                      className="mt-0.5 w-full rounded-[7px] border border-line bg-panel-2 px-2 py-1.5 text-[12px] text-ink"
                    />
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line-soft px-5 py-3">
          <span className="flex items-center gap-1.5 text-[11px]">
            {saved && (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="text-good" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span className="text-good">已保存，TeslaMate 面板同步生效</span>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            取消
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!writable || saving || loading}
            className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-[12px] text-ink transition-colors hover:bg-hover disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
