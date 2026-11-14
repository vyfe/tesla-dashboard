import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "tesla-dashboard-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** 图表用的具体色值。CSS 变量给 DOM，这里给 Recharts 的 SVG 属性。 */
export interface ChartColors {
  axis: string;
  grid: string;
  cursor: string;
  drive: string;
  charge: string;
  accent: string;
  good: string;
  warn: string;
  info: string;
}

const LIGHT_COLORS: ChartColors = {
  axis: "#6f7b88",
  grid: "#e9eef4",
  cursor: "#c9d3de",
  drive: "#3f6fa8",
  charge: "#b4761f",
  accent: "#d81f26",
  good: "#2f855a",
  warn: "#a16207",
  info: "#2f6fb3",
};

const DARK_COLORS: ChartColors = {
  axis: "#707d8a",
  grid: "#161d26",
  cursor: "#2a3644",
  drive: "#6c87a3",
  charge: "#d9a05b",
  accent: "#e82127",
  good: "#58b368",
  warn: "#d29922",
  info: "#5b8def",
};

interface ThemeValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  cycle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function readMode(): ThemeMode {
  try {
    // 方便截图/嵌入时强制主题：?theme=light|dark
    const query = new URLSearchParams(window.location.search).get("theme");
    if (query === "light" || query === "dark") return query;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "auto" || stored === "light" || stored === "dark") return stored;
  } catch {
    /* 隐私模式下 localStorage 可能不可用，回退到自动 */
  }
  return "auto";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  const resolved: ResolvedTheme = mode === "auto" ? system : mode;

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    // ?theme= 只用于截图/嵌入，不写回用户偏好
    if (!new URLSearchParams(window.location.search).get("theme")) {
      try {
        window.localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        /* 忽略写入失败 */
      }
    }
  }, [mode, resolved]);

  const cycle = useCallback(() => {
    setMode((current) => (current === "auto" ? "light" : current === "light" ? "dark" : "auto"));
  }, []);

  const value = useMemo(
    () => ({ mode, resolved, setMode, cycle }),
    [mode, resolved, cycle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return value;
}

export function useChartColors(): ChartColors {
  const { resolved } = useTheme();
  return resolved === "dark" ? DARK_COLORS : LIGHT_COLORS;
}
