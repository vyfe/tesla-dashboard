import { useTheme, type ThemeMode } from "../lib/theme";
import { persistSettings } from "../lib/settings";

const LABEL: Record<ThemeMode, string> = { auto: "自动", light: "浅色", dark: "深色" };

function Icon({ mode }: { mode: ThemeMode }) {
  if (mode === "light") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </svg>
    );
  }
  if (mode === "dark") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17A8.5 8.5 0 0 0 12 3.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ThemeToggle() {
  const { mode, cycle } = useTheme();

  // 切换主题的同时写回 TeslaMate 的 settings 表，两边保持一致
  const handleClick = () => {
    const next: ThemeMode = mode === "auto" ? "light" : mode === "light" ? "dark" : "auto";
    cycle();
    void persistSettings({ theme_mode: next === "auto" ? "system" : next });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`主题：${LABEL[mode]}，点击切换`}
      aria-label={`主题：${LABEL[mode]}，点击切换`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:bg-hover hover:text-ink"
    >
      <Icon mode={mode} />
      <span className="hidden sm:inline">{LABEL[mode]}</span>
    </button>
  );
}
