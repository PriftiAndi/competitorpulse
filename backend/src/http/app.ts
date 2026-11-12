import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { competitors, snapshots } from "../db/schema.js";
import type { EventBus } from "../events.js";
import { llmCallsToday, pacedAllowance } from "../llm/budget.js";
import { intervalForStreak } from "../scheduler/interval.js";
import type { PollerStats } from "../scheduler/poller.js";
import { toCompetitorDto, toSnapshotDto } from "./dto.js";
import { registerEventsRoute } from "./events.js";

export type AppDeps = {
  db: Db;
  config: Config;
  pollerStats: () => PollerStats | null;
  llmModel: string | null;
  events: EventBus;
};

const COMPETITOR_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const createBody = z.object({
  id: z
    .string()
    .trim()
    .toLowerCase()
    .regex(COMPETITOR_ID, "id must be 1-100 chars: lowercase letters, digits, '.', '_' or '-'"),
});
const idParams = z.object({ id: z.string().regex(COMPETITOR_ID) });
const snapshotsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.coerce.number().int().positive().optional(),
});

export function buildApp(deps: AppDeps): FastifyInstance {
  const { db, config, events } = deps;
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  const dto = (row: Parameters<typeof toCompetitorDto>[0], now?: Date) =>
    toCompetitorDto(row, intervalForStreak(row.unchangedStreak, config), now);
  // Accept `content-type: application/json` with an empty body (common for bodiless POSTs).
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "") return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(Object.assign(err as Error, { statusCode: 400 }), undefined);
    }
  });
  registerEventsRoute(app, events);

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/status", async () => ({
    scheduler: deps.pollerStats(),
    sseClients: events.listenerCount,
    llm: {
      enabled: deps.llmModel !== null,
      model: deps.llmModel,
      dailyCap: config.LLM_DAILY_CAP,
      callsToday: await llmCallsToday(db),
      paceHourly: config.LLM_PACE_HOURLY,
      allowedSoFarToday: config.LLM_PACE_HOURLY ? pacedAllowance(config.LLM_DAILY_CAP) : config.LLM_DAILY_CAP,
    },
    config: {
      pollIntervalSeconds: config.POLL_INTERVAL_SECONDS,
      pollMaxIntervalSeconds: config.POLL_MAX_INTERVAL_SECONDS,
      pollBackoffEvery: config.POLL_BACKOFF_EVERY,
      sourceBaseUrl: config.SOURCE_BASE_URL,
      sourceMaxRps: config.SOURCE_MAX_RPS,
      retentionDays: config.RETENTION_DAYS,
    },
  }));

  app.get("/api/competitors", async () => {
    const rows = await db.select().from(competitors).where(isNull(competitors.removedAt)).orderBy(competitors.id);
    const now = new Date();
    return rows.map((r) => dto(r, now));
  });

  app.post("/api/competitors", async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid body" });
    }
    const { id } = parsed.data;

    // Unknown ids are accepted on purpose: the source cannot be asked reliably
    // (it is flaky and rate limited) and a competitor may appear later. The
    // first poll runs right away and the timeline shows what the source said.
    const created = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(competitors).where(eq(competitors.id, id)).for("update");
      if (existing && existing.removedAt === null) return null;
      if (existing) {
        const [restored] = await tx
          .update(competitors)
          .set({ removedAt: null, nextPollAt: new Date() })
          .where(eq(competitors.id, id))
          .returning();
        return restored ?? null;
      }
      const [inserted] = await tx.insert(competitors).values({ id, nextPollAt: new Date() }).returning();
      return inserted ?? null;
    });
    if (!created) return reply.code(409).send({ error: `competitor '${id}' is already tracked` });
    events.emit({ type: "competitor.added", competitorId: id });
    return reply.code(201).send(dto(created));
  });

  app.get("/api/competitors/:id", async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid id" });
    const [row] = await db
      .select()
      .from(competitors)
      .where(and(eq(competitors.id, params.data.id), isNull(competitors.removedAt)));
    if (!row) return reply.code(404).send({ error: "competitor not found" });
    return dto(row);
  });

  app.delete("/api/competitors/:id", async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid id" });
    // Soft delete: polling stops, history stays (and comes back if re-added).
    const [row] = await db
      .update(competitors)
      .set({ removedAt: new Date() })
      .where(and(eq(competitors.id, params.data.id), isNull(competitors.removedAt)))
      .returning({ id: competitors.id });
    if (!row) return reply.code(404).send({ error: "competitor not found" });
    events.emit({ type: "competitor.removed", competitorId: row.id });
    return reply.code(204).send();
  });

  app.get("/api/competitors/:id/snapshots", async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid id" });
    const query = snapshotsQuery.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "invalid query" });

    const [competitor] = await db
      .select({ id: competitors.id })
      .from(competitors)
      .where(and(eq(competitors.id, params.data.id), isNull(competitors.removedAt)));
    if (!competitor) return reply.code(404).send({ error: "competitor not found" });

    const conditions = [eq(snapshots.competitorId, params.data.id)];
    if (query.data.before !== undefined) conditions.push(lt(snapshots.id, query.data.before));
    const rows = await db
      .select()
      .from(snapshots)
      .where(and(...conditions))
      .orderBy(desc(snapshots.fetchedAt), desc(snapshots.id))
      .limit(query.data.limit);
    return rows.map(toSnapshotDto);
  });

  /** Asks the scheduler to poll this competitor on its next tick. */
  app.post("/api/competitors/:id/poll", async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid id" });
    const [row] = await db
      .update(competitors)
      .set({ nextPollAt: sql`now()` })
      .where(and(eq(competitors.id, params.data.id), isNull(competitors.removedAt)))
      .returning({ id: competitors.id });
    if (!row) return reply.code(404).send({ error: "competitor not found" });
    return reply.code(202).send({ ok: true });
  });

  return app;
}
