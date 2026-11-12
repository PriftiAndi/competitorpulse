import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { pruneSnapshots } from "./domain/snapshots.js";
import { createEventBus } from "./events.js";
import { buildApp } from "./http/app.js";
import { createLlmClient } from "./llm/client.js";
import { startSummarizer } from "./llm/summarizer.js";
import { startPoller, type Poller } from "./scheduler/poller.js";
import { createSourceClient } from "./source/client.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await runMigrations(config.DATABASE_URL);
  const { db, pool } = createDb(config.DATABASE_URL);

  const llm =
    config.LLM_BASE_URL.trim() === ""
      ? null
      : createLlmClient({
          baseUrl: config.LLM_BASE_URL,
          apiKey: config.LLM_API_KEY,
          model: config.LLM_MODEL,
          timeoutMs: config.LLM_TIMEOUT_MS,
        });
  const source = createSourceClient({
    baseUrl: config.SOURCE_BASE_URL,
    timeoutMs: config.SOURCE_TIMEOUT_MS,
    maxAttempts: config.SOURCE_MAX_ATTEMPTS,
  });

  const events = createEventBus();
  let poller: Poller | null = null;
  const app = buildApp({
    db,
    config,
    pollerStats: () => poller?.stats() ?? null,
    llmModel: llm?.model ?? null,
    events,
  });
  await app.listen({ port: config.PORT, host: "0.0.0.0" });

  let summarizer: ReturnType<typeof startSummarizer> | null = null;
  let retentionTimer: NodeJS.Timeout | null = null;
  if (config.SCHEDULER_ENABLED) {
    poller = startPoller({ db, config, source, logger: app.log, llmEnabled: llm !== null, events });
    summarizer = startSummarizer({ db, config, llm, logger: app.log, events });
    const prune = () =>
      pruneSnapshots(db, config.RETENTION_DAYS)
        .then((n) => n > 0 && app.log.info({ deleted: n }, "pruned old snapshots"))
        .catch((err) => app.log.error({ err }, "retention job failed"));
    void prune();
    retentionTimer = setInterval(prune, 60 * 60 * 1000);
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, "shutting down");
    if (retentionTimer) clearInterval(retentionTimer);
    await Promise.allSettled([poller?.stop(), summarizer?.stop()]);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
