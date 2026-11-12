import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys } from "@/api/queries";
import type { DomainEvent } from "@/api/types";

export type LiveState = "connecting" | "live" | "reconnecting";

const EVENT_TYPES: DomainEvent["type"][] = [
  "competitor.added",
  "competitor.removed",
  "snapshot.recorded",
  "summary.updated",
];

/**
 * Subscribes once to the backend's Server-Sent Events stream and invalidates
 * exactly the cached queries an event affects. The browser's EventSource
 * reconnects by itself; the returned state drives the "Live" indicator.
 */
export function useLiveUpdates(): LiveState {
  const client = useQueryClient();
  const [state, setState] = useState<LiveState>("connecting");

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onopen = () => {
      setState("live");
      // Anything could have happened while disconnected.
      void client.invalidateQueries();
    };
    source.onerror = () => setState("reconnecting");

    const onEvent = (raw: MessageEvent<string>) => {
      const event = JSON.parse(raw.data) as DomainEvent;
      void client.invalidateQueries({ queryKey: queryKeys.status });
      switch (event.type) {
        case "competitor.added":
        case "competitor.removed":
          void client.invalidateQueries({ queryKey: queryKeys.competitors });
          break;
        case "snapshot.recorded":
          void client.invalidateQueries({ queryKey: queryKeys.competitors });
          void client.invalidateQueries({ queryKey: queryKeys.snapshots(event.competitorId) });
          break;
        case "summary.updated":
          void client.invalidateQueries({ queryKey: queryKeys.snapshots(event.competitorId) });
          break;
      }
    };
    for (const type of EVENT_TYPES) source.addEventListener(type, onEvent);

    return () => source.close();
  }, [client]);

  return state;
}
