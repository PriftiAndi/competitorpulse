import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/client";

/** Fallback refetch interval; the SSE stream (api/live.ts) is the primary trigger. */
export const FALLBACK_REFETCH_MS = 30_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchInterval: FALLBACK_REFETCH_MS,
      refetchIntervalInBackground: false,
      // 4xx answers are definitive; only network/5xx deserve a retry.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});
