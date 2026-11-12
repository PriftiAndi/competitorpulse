# CompetitorPulse

Tracks competitor product listings over time, decides which changes matter to a
product manager, and asks an LLM to explain those changes in plain English.

- **Backend:** Node.js 20, TypeScript (strict), Fastify, Postgres 16, Drizzle ORM + drizzle-kit migrations.
- **Frontend:** React 19 + Vite, two views (competitor list, competitor timeline). Plain CSS with design tokens, no UI library; supports dark mode and phone widths.
- **LLM:** any OpenAI Chat Completions compatible endpoint. Developed and demoed against **Groq** (free tier,
  model `openai/gpt-oss-120b`); the provided mock LLM is the compose default so the system runs with no key.
- **Runs with one command:** `docker compose up --build`.

## Running locally

```bash
docker compose up --build
```

| What | Where |
| --- | --- |
| UI | http://localhost:8080 |
| API | http://localhost:4000/api (also proxied at http://localhost:8080/api) |
| Listing source (vendored copy of the provided server) | http://localhost:4002 (control endpoints exposed for testing) |
| Mock LLM (vendored copy of the provided server) | http://localhost:4001 |

Defaults in compose: poll every **60 s** (the production target is 900 s), max **4 req/s** to the source, LLM daily cap **2000**.
Add `acme-crm`, `ferry-pay`, `orbit-hr`, `north-analytics` or `lumen-docs` in the UI, then make the source change
to see summaries appear:

```bash
curl -X POST localhost:4002/control/advance -d '{"id":"acme-crm","steps":2}'   # price 39 -> 29
curl -X POST localhost:4002/control/advance -d '{"id":"ferry-pay","steps":2}'  # delisted
```

Use the **Poll now** button on a timeline instead of waiting for the next scheduled poll.

### Configuration

All settings are environment variables (see `backend/src/config.ts` for the full list and
`.env.example` for the compose overrides). Copy `.env.example` to `.env` to change them.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SOURCE_BASE_URL` | `http://listing-source:4002` | **Base URL of the listing source.** Point it at your own instance here. |
| `SOURCE_MAX_RPS` | `4` | Client-side request rate to the source. Keep it under the source's global limit. |
| `SOURCE_TIMEOUT_MS` / `SOURCE_MAX_ATTEMPTS` | `10000` / `2` | Per-request timeout and attempts for transient failures. |
| `POLL_INTERVAL_SECONDS` | `60` | How often each competitor is polled. |
| `LLM_BASE_URL` | `http://mock-llm:4001/v1` | OpenAI-compatible base URL. Empty string disables summaries. |
| `LLM_API_KEY` / `LLM_MODEL` | `mock-key` / `mock-llm` | Credentials and model. |
| `LLM_DAILY_CAP` | `2000` | Hard cap on LLM calls per UTC day. |
| `LLM_TIMEOUT_MS` / `LLM_MAX_ATTEMPTS` | `15000` / `3` | Timeout per call and attempts before giving up. |
| `RETENTION_DAYS` | `90` | Snapshots older than this are pruned hourly. |

**Which LLM I used:** Groq's free tier with `openai/gpt-oss-120b`, through its OpenAI-compatible endpoint. It is not
committed anywhere; it lives in a git-ignored `.env`:

```bash
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=gsk_...
LLM_MODEL=openai/gpt-oss-120b
```

Without a `.env` the compose file falls back to the mock LLM, which echoes the prompt instead of summarising, so a
reviewer gets a working system with no key. OpenAI works the same way (`https://api.openai.com/v1`, `gpt-4o-mini`),
as does Ollama (`http://host.docker.internal:11434/v1`, `llama3.2`). No code change is needed; the client only relies on
`choices[0].message.content`.

**Pointing at a different source:** set `SOURCE_BASE_URL`. From inside Docker a service on the host is
`http://host.docker.internal:4002`.

### Development without Docker

```bash
docker compose up postgres listing-source mock-llm      # or run the vendored servers directly
cd backend && npm install && npm run db:migrate && npm run dev   # API on :4000, migrates on start too
cd frontend && npm install && npm run dev                        # UI on :5173, proxies /api to :4000
cd backend && npm test                                           # unit tests (normalisation + diffing)
```

Migrations live in `backend/drizzle/` and are generated with `npm run db:generate` after editing
`backend/src/db/schema.ts`. The backend applies pending migrations on startup, so `docker compose up` is the one command.

## API

The required contract plus a few additions:

```
GET    /api/competitors                   -> [Competitor]        (active ones)
POST   /api/competitors   { id }          -> 201 Competitor | 400 invalid id | 409 already tracked
DELETE /api/competitors/:id               -> 204 | 404
GET    /api/competitors/:id               -> Competitor | 404
GET    /api/competitors/:id/snapshots     -> [Snapshot] newest first  (?limit=100&before=<snapshotId> for paging)
POST   /api/competitors/:id/poll          -> 202  (poll on the next scheduler tick)
GET    /api/status                        -> scheduler stats, LLM usage today, effective config
GET    /api/health
```

`Competitor` adds `lastPolledAt`, `lastStatus`, `lastChangedAt`, `changedInLast24h`, `nextPollAt`.
`Snapshot` adds `status` (`ok | partial | not_found | error`), `missingFields`, `error`, `changes`
(structured before/after per field), `summaryStatus`, `summaryReason` (human text explaining why there is no
summary) and `summarySource` (`llm | rule`).

## How it works

```
 scheduler loop (1s tick)                      summary worker (2s tick)
 ┌──────────────────────────────┐              ┌──────────────────────────────┐
 │ claim due competitors        │              │ claim snapshots with         │
 │  (FOR UPDATE SKIP LOCKED)    │              │  summary_status = 'pending'  │
 │ token bucket @ SOURCE_MAX_RPS│              │  (FOR UPDATE SKIP LOCKED,    │
 │ bounded concurrency          │              │   120s lease)                │
 │ fetch -> normalise -> diff   │   insert     │ reserve 1 call from daily    │
 │ store snapshot (always)      │ ──────────▶  │  budget (atomic upsert)      │
 │ changed? -> 'pending'        │              │ call LLM w/ timeout, retry   │
 └──────────────────────────────┘              │  w/ backoff, store result    │
                                               └──────────────────────────────┘
```

Key files: `backend/src/scheduler/poller.ts`, `backend/src/source/normalize.ts`, `backend/src/domain/diff.ts`,
`backend/src/domain/snapshots.ts`, `backend/src/llm/summarizer.ts`, `backend/src/llm/budget.ts`,
`backend/src/http/app.ts`.

## Decisions

### What counts as a change that matters

A product manager cares about **title, tagline, price, description and availability** (listed vs. not listed).
Everything else in the source's response is noise and is dropped at normalisation time: unknown fields
(`requestId`, `viewerCount`, `promoBanner`, `cache`, `renderedAt`), key order, surrounding and repeated whitespace,
HTML entities (`&amp;`, `&nbsp;`), and price formatting. Prices are parsed into `{amount, currency, period}` so that
`$29/mo`, `$29 / month`, `USD 29 per month` and `$29.00/mo` are equal, and `Free`, `$0/mo`, `Free forever` are equal.
A price the parser does not understand (e.g. "Contact sales") is compared as cleaned text instead of being dropped.

Text comparison is case-sensitive after normalisation. I considered case-insensitive comparison and
fuzzy/semantic comparison of descriptions, and left both out: the source never varies case, and a
"description changed" that turns out to be a typo fix costs one LLM call and is still useful to see.

**Partial responses** (a field missing, empty or null) are a source hiccup, not a product change. The missing field
is carried forward from the last known value, the snapshot is stored as `partial` with `missingFields` so the UI can
say "not returned by the source in this poll; last known value", and no change is reported for that field.
Alternative considered: re-fetch immediately. Rejected because it spends rate-limit budget on something the next
poll will fix anyway.

**Availability**: a 404 after a listing is a change (`listed -> not listed`), and so is coming back. These are
summarised by a fixed sentence instead of the LLM: the sentence is always right, and it saves budget.
If a competitor comes back with different fields, the diff is against the last listed state and the LLM is called.

**Failed polls** (5xx, timeout, garbage body) are stored as `error` snapshots so the timeline is honest about gaps,
but they never count as a change and never update the "last known state".

**First snapshot** is never a change (`no_previous`), so adding a competitor does not spend an LLM call.

### Adding an id the source does not know

Any well-formed id (`^[a-z0-9][a-z0-9._-]{0,99}$`) is accepted and polled immediately. The source is not asked
synchronously because it is slow, flaky and rate limited, and because a competitor can legitimately not exist
*yet*. The list view shows the last status ("Not listed at the source") so a typo is visible within seconds, and
polling continues at the normal interval in case the competitor appears. Alternative considered: probe on add and
reject with 404. Rejected: a 5xx or 429 during the probe would make the answer ambiguous, and the
"disappears and comes back" behaviour means a 404 is not proof the id is wrong.

### Removing a competitor

Soft delete (`removed_at`). Polling stops immediately, history is kept for the retention window, and re-adding
the id restores its timeline. Hard delete was the alternative; soft delete costs one column and avoids losing
90 days of history to a misclick.

### Scheduling and the rate limit

Each competitor has a `next_poll_at`. A loop claims due rows with `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`,
which makes polling safe to run on several backend instances with no coordination service. Outgoing requests go
through a client-side token bucket (`SOURCE_MAX_RPS`, default 4 < 5) with bounded concurrency, so under normal
conditions the source never sees a 429. If it does answer 429 (e.g. a stricter instance), the `Retry-After` pauses
the whole bucket, not just one worker, because the limit is global on the source side; the competitor is put back at
the front of the queue and no snapshot is written for the 429 (it is our fault, not a source event).
Alternatives considered: a cron-per-competitor library (BullMQ etc.) would need Redis for no gain at this size; an
adaptive limiter that lowers `SOURCE_MAX_RPS` on repeated 429s is a small next step.

### Snapshot persistence

One `snapshots` row per poll, including unchanged and failed polls, with the normalised fields, the structured diff
(`changes` jsonb), and the summary lifecycle columns. Index on `(competitor_id, fetched_at desc)` serves the
timeline; a partial index on `summary_next_attempt_at WHERE summary_status = 'pending'` serves the worker queue.
Retention is an hourly batched delete of rows older than `RETENTION_DAYS`.

Considered and left out: a separate `listing_versions` table so unchanged polls store only a pointer
(would cut storage ~5x), and monthly partitioning so retention becomes `DROP PARTITION`. Both are the first things
I would add at production volume (see below); at assignment size they add joins without changing behaviour.
The raw source payload is not stored; it would be useful for debugging the normaliser and belongs in object
storage with a short TTL.

### LLM integration

The poll result is always committed before anything LLM-related happens; a change just marks the snapshot
`pending`. A separate worker claims pending rows with a 120 s lease (a crash mid-call leaves the row to be retried),
reserves one call from the daily budget with an atomic conditional upsert
(`... ON CONFLICT DO UPDATE SET calls = calls + 1 WHERE calls < cap`), calls the LLM with a hard timeout, and stores
the outcome. Transport failures, timeouts, 429 and 5xx retry with exponential backoff up to `LLM_MAX_ATTEMPTS`;
other 4xx (bad key, unknown model) fail immediately because retrying cannot fix them; empty or malformed answers are
stored as `unusable` and not retried. Every attempt is charged to the budget, including
failed ones: conservative on purpose, since finance's cap is on spend, not on successes.

What the user sees, in every case, is the structured diff (before -> after per field), so a missing summary never
hides *what* changed. On top of that the snapshot carries a `summaryStatus` and a `summaryReason` sentence:
"being generated", "LLM call failed after 3 attempts: timeout after 15000ms", "daily LLM cap reached",
"answer was unusable", "no LLM configured", "nothing changed", "first snapshot", "poll failed".

When the cap is reached the change is marked `cap_reached` immediately rather than queued for tomorrow: a
day-old summary of a price change is not what a PM wants, and the diff is already on screen.

### The production numbers

- **Polling:** 6,000 competitors / 15 min = 6.7 req/s, above the 5 req/s limit before counting retries. Options,
  in the order I would try them: (1) ask for the interval to become 25 min (6,000 / 5 req/s = 20 min at 100%
  utilisation; 25 min leaves room for retries); (2) tiered intervals, e.g. the top 1,000 competitors every
  15 min and the rest every 30-60 min, driven by how often each has changed historically; (3) adaptive
  backoff per competitor: one that has not changed in a week is polled less often. (4) If the source offered
  conditional requests (ETag) the budget problem would mostly disappear; it does not, so this is a conversation
  with the source owner. The scheduler already supports (2) and (3) with one extra column (`interval_seconds`
  per competitor); only the policy is missing.
- **LLM cap:** 576,000 polls/day. If even 0.5% of polls are real changes that is 2,880 calls, over the cap.
  Mitigations already in place: rule-based summaries for availability changes, no call for first snapshots, the
  structured diff as a fallback. Next: templated summaries for single-field price changes
  ("Price changed from $39/mo to $29/mo" needs no model), coalescing several changes of the same competitor
  within an hour into one call, and pacing the budget across the day (e.g. at most cap/24 per hour) so a burst at
  09:00 does not leave the afternoon with nothing. Priority ordering (price before copy) if the cap is still hit.
- **Storage:** 576,000 rows/day x 90 days = 52 M rows, roughly 25-30 GB with the text columns. Fine for Postgres,
  but I would partition by day (retention = drop partition, no delete churn) and dedupe listing text into a
  versions table so unchanged polls are ~50 bytes.
- **Process shape:** the API, scheduler and summary worker run in one process here. The SKIP LOCKED claiming means
  they can be split into separate deployables and scaled independently with no code change beyond a flag
  (`SCHEDULER_ENABLED` already exists).

## Left out on purpose

- Authentication, multi-user, and input rate limiting on the API (brief says one internal user).
- Storing the raw source payload.
- UI pagination of the timeline (the API supports `?before=`; the UI loads the latest 200).
- Integration tests against a real Postgres and an end-to-end test of the scheduler. The unit tests cover the
  parts with the most judgment (normalisation and diffing); the scheduler and worker were verified manually
  against the vendored source and mock LLM with their `/control` endpoints (5xx, timeouts, partials, 429,
  LLM failures, LLM cap).
- Metrics/tracing. The `/api/status` endpoint and structured pino logs are the observability for now.
- Adaptive rate limiting and per-competitor intervals (designed for, not implemented).

## Deployment

The whole stack runs on one Docker-capable VM with the same compose file plus a production override that adds
Caddy for HTTPS and stops exposing internal ports. The target is an **Oracle Cloud Always Free** Ampere A1
(arm64) instance; all base images are multi-arch and the images are built on the VM, so nothing changes for arm64.

```bash
# on a fresh Ubuntu VM with ports 80/443 open in the cloud firewall:
DOMAIN=pulse.example.com REPO=https://github.com/<you>/competitorpulse.git bash deploy/install-and-run.sh
```

The script installs Docker, opens 80/443 in the OS firewall (Oracle's images block them by default), clones the
repo into `/opt/competitorpulse`, writes `DOMAIN` into `.env`, and runs
`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`. Caddy obtains the certificate from
Let's Encrypt on first request. Postgres data lives in a named volume; a managed Postgres would be the first
change for a real deployment.

Live instance: _link added here once deployed_.

## AI tools used

Claude Code (Anthropic Claude Fable 5.1) was used throughout for scaffolding, writing most of the code and the unit tests,
with me steering the design decisions above and reviewing every file.

One place where I changed what the AI proposed: it recommended shipping against the mock LLM only, on the grounds
that the brief allows it and the mock exercises the failure paths. I disagreed: an integration that has only ever
talked to an echo server has not been tested, so I insisted on a real provider and wired in Groq. The first real
call failed with `404 model_not_found` (the model name the AI suggested had been retired), and the summary worker
retried it three times with exponential backoff, charging the daily budget on every attempt. That was a real
defect in the retry design: it treated every error as transient. The fix classifies errors in the LLM client
(`retryable` is true only for timeouts, network errors, 408, 429 and 5xx); a client error now marks the summary
`failed` on the first attempt and costs one unit of budget, not three. The mock never would have shown this, because
it only knows how to return 200 or 500.

A second, smaller one: the first UI refreshed by polling the API every five seconds. I asked whether polling the
backend was really needed when the backend knows the exact moment a snapshot or summary lands, and we replaced it
with a Server-Sent Events stream that invalidates only the affected queries, keeping a slow refetch as a fallback.
