import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { competitorsApi } from "@/api/competitors";

/** Single source of truth for cache keys, so invalidation can't drift from queries. */
export const queryKeys = {
  status: ["status"] as const,
  competitors: ["competitors"] as const,
  snapshots: (id: string) => ["snapshots", id] as const,
};

export function useSystemStatus() {
  return useQuery({ queryKey: queryKeys.status, queryFn: competitorsApi.status, refetchInterval: 15_000 });
}

export function useCompetitors() {
  return useQuery({ queryKey: queryKeys.competitors, queryFn: competitorsApi.list });
}

export function useSnapshots(id: string) {
  return useQuery({ queryKey: queryKeys.snapshots(id), queryFn: () => competitorsApi.snapshots(id), enabled: id !== "" });
}

export function useAddCompetitor() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: competitorsApi.add,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.competitors }),
  });
}

export function useRemoveCompetitor() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: competitorsApi.remove,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.competitors }),
  });
}

export function usePollNow() {
  return useMutation({ mutationFn: competitorsApi.pollNow });
}
