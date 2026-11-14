import type { DataSource } from "./datasource";
import { mockApi } from "./mock";
import type {
  Battery,
  ChargesPage,
  DrivesPage,
  DriveDetail,
  Meta,
  Overview,
  TimelineData,
  VehicleStatus,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      detail = body.detail ?? detail;
    } catch {
      /* 非 JSON 响应，保持默认信息 */
    }
    throw new ApiError(response.status, detail);
  }
  return (await response.json()) as T;
}

/** 真实数据源：直连后端 /api/*。 */
const httpApi: DataSource = {
  meta: () => get<Meta>("/api/meta"),
  status: (car?: number) => get<VehicleStatus>("/api/status", { car }),
  timeline: (car?: number, days = 7) => get<TimelineData>("/api/timeline", { car, days }),
  overview: (car?: number) => get<Overview>("/api/overview", { car }),
  drives: (params: { car?: number; limit?: number; offset?: number; date_from?: string }) =>
    get<DrivesPage>("/api/drives", params),
  drive: (id: number, car?: number) => get<DriveDetail>(`/api/drives/${id}`, { car }),
  battery: (car?: number) => get<Battery>("/api/battery", { car }),
  charges: (params: { car?: number; limit?: number; offset?: number }) =>
    get<ChargesPage>("/api/charges", params),
};

/**
 * 数据源在**构建期**决定，不在运行期判断。
 *
 * VITE_DEMO=1 时整棵 mock 依赖会被打进产物；不设置时这个三元表达式被折叠成 httpApi，
 * mock 模块随之被 tree-shaking 掉——生产包里不会残留任何假数据代码。
 */
const isDemo = import.meta.env.VITE_DEMO === "1";

export const api: DataSource = isDemo ? mockApi : httpApi;

/** 当前是不是 demo 模式。页面据此显示「示例数据」标识。 */
export const IS_DEMO = isDemo;
