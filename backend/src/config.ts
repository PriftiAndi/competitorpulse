import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z
    .string()
    .default("postgres://competitorpulse:competitorpulse@localhost:5432/competitorpulse"),

  // Listing source (the "external website")
  SOURCE_BASE_URL: z.string().url().default("http://localhost:4002"),
  SOURCE_MAX_RPS: z.coerce.number().positive().default(4),
  SOURCE_CONCURRENCY: z.coerce.number().int().positive().default(10),
  SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  SOURCE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(2),

  // Scheduler. The interval doubles after every POLL_BACKOFF_EVERY consecutive
  // unchanged polls, up to POLL_MAX_INTERVAL_SECONDS, and resets on a change.
  POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  POLL_MAX_INTERVAL_SECONDS: z.coerce.number().int().positive().optional(),
  POLL_BACKOFF_EVERY: z.coerce.number().int().positive().default(10),
  POLL_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  SCHEDULER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // LLM (OpenAI Chat Completions compatible). Empty base URL disables summaries.
  LLM_BASE_URL: z.string().default("http://localhost:4001/v1"),
  LLM_API_KEY: z.string().default("mock-key"),
  LLM_MODEL: z.string().default("mock-llm"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  LLM_DAILY_CAP: z.coerce.number().int().nonnegative().default(2000),
  // Spread the daily cap across the day (cap * (hour+1)/24 by hour h, unused budget rolls forward).
  LLM_PACE_HOURLY: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  LLM_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  LLM_CONCURRENCY: z.coerce.number().int().positive().default(4),

  // History retention
  RETENTION_DAYS: z.coerce.number().int().positive().default(90),
});

export type Config = Omit<z.infer<typeof envSchema>, "POLL_MAX_INTERVAL_SECONDS"> & {
  POLL_MAX_INTERVAL_SECONDS: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const data = parsed.data;
  const max = data.POLL_MAX_INTERVAL_SECONDS ?? data.POLL_INTERVAL_SECONDS * 4;
  if (max < data.POLL_INTERVAL_SECONDS) {
    throw new Error("Invalid configuration: POLL_MAX_INTERVAL_SECONDS must be >= POLL_INTERVAL_SECONDS");
  }
  return { ...data, POLL_MAX_INTERVAL_SECONDS: max };
}
