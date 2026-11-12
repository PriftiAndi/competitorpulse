import { request } from "@/api/client";
import type { Competitor, Snapshot, SystemStatus } from "@/api/types";

const competitorPath = (id: string) => `/api/competitors/${encodeURIComponent(id)}`;

export const competitorsApi = {
  status: () => request<SystemStatus>("/api/status"),
  list: () => request<Competitor[]>("/api/competitors"),
  add: (id: string) => request<Competitor>("/api/competitors", { method: "POST", body: { id } }),
  remove: (id: string) => request<void>(competitorPath(id), { method: "DELETE" }),
  snapshots: (id: string, limit = 200) => request<Snapshot[]>(`${competitorPath(id)}/snapshots?limit=${limit}`),
  pollNow: (id: string) => request<{ ok: true }>(`${competitorPath(id)}/poll`, { method: "POST" }),
};
