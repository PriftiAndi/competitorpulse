import type { FastifyInstance } from "fastify";
import type { EventBus } from "../events.js";

const HEARTBEAT_MS = 15_000;

/**
 * GET /api/events: a Server-Sent Events stream of domain events, so the UI
 * refreshes when something actually happens instead of polling.
 */
export function registerEventsRoute(app: FastifyInstance, bus: EventBus): void {
  app.get("/api/events", (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no", // tell nginx not to buffer
    });
    res.write("retry: 3000\n\n");

    const unsubscribe = bus.subscribe((event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };
    req.raw.on("close", close);
    req.raw.on("error", close);
  });
}
