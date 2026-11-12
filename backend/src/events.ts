import { EventEmitter } from "node:events";

/**
 * Domain events that the UI cares about. Emitted in-process and streamed to
 * browsers over Server-Sent Events (see http/events.ts).
 *
 * Single-instance by design: with several backend replicas this would be
 * backed by Postgres LISTEN/NOTIFY so every instance sees every event.
 */
export type DomainEvent =
  | { type: "competitor.added"; competitorId: string }
  | { type: "competitor.removed"; competitorId: string }
  | { type: "snapshot.recorded"; competitorId: string; snapshotId: number; changed: boolean }
  | { type: "summary.updated"; competitorId: string; snapshotId: number; status: string };

export type EventListener = (event: DomainEvent) => void;

export type EventBus = {
  emit(event: DomainEvent): void;
  subscribe(listener: EventListener): () => void;
  readonly listenerCount: number;
};

export function createEventBus(): EventBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  return {
    emit(event) {
      emitter.emit("event", event);
    },
    subscribe(listener) {
      emitter.on("event", listener);
      return () => emitter.off("event", listener);
    },
    get listenerCount() {
      return emitter.listenerCount("event");
    },
  };
}
