import type {
  Battery,
  ChargesPage,
  DrivesPage,
  DriveDetail,
  Meta,
  Overview,
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

export const api = {
  meta: () => get<Meta>("/api/meta"),
  overview: (car?: number) => get<Overview>("/api/overview", { car }),
  drives: (params: { car?: number; limit?: number; offset?: number; date_from?: string }) =>
    get<DrivesPage>("/api/drives", params),
  drive: (id: number, car?: number) => get<DriveDetail>(`/api/drives/${id}`, { car }),
  battery: (car?: number) => get<Battery>("/api/battery", { car }),
  charges: (params: { car?: number; limit?: number; offset?: number }) =>
    get<ChargesPage>("/api/charges", params),
};
