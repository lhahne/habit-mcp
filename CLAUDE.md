# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
pnpm dev                   # wrangler dev on http://localhost:8787
pnpm test                  # full vitest suite (offline, Miniflare-backed)
pnpm test:watch            # vitest in watch mode
pnpm exec vitest run test/habits.test.ts   # single test file
pnpm exec vitest run -t "creates a habit"  # single test by name
pnpm typecheck             # tsc --noEmit
pnpm migrate:local         # apply migrations to local D1 (needed before `pnpm dev`)
pnpm migrate:remote        # apply migrations to deployed D1
pnpm deploy                # wrangler deploy
```

Local setup: `cp .dev.vars.example .dev.vars` and set `AUTH_PASSWORD` before `pnpm dev`.

One-off Vectorize index creation (required before first deploy / before search will return anything in prod):

```sh
pnpm exec wrangler vectorize create habit-mcp-text --dimensions=1024 --metric=cosine
```

If the embedding model is changed later, the dimensions may differ. Recreate the index (`vectorize delete` then `create`) and call the `reindex_embeddings` MCP tool to repopulate.

## Architecture

This is a single-user **MCP server** running on **Cloudflare Workers + D1**, deployed as a remote connector for claude.ai. Three layers matter:

1. **OAuth wrapper (`src/index.ts`)** — `@cloudflare/workers-oauth-provider` intercepts all requests. Requests to `/mcp` go through `mcpApiHandler` only after bearer-token validation. Everything else (including `/authorize`) goes to `authHandler`. The provider injects an `env.OAUTH_PROVIDER` binding used inside the auth handler to complete the flow.

2. **Auth handler (`src/auth/handler.ts`)** — implements a single-password OAuth 2.1 + PKCE flow. `GET /authorize` renders a login page; `POST /authorize` compares the submitted password against `env.AUTH_PASSWORD` using a SHA-256 timing-safe compare, then calls `OAUTH_PROVIDER.completeAuthorization` with a hard-coded `userId: "owner"`. There is no user table — this is deliberately single-user.

3. **MCP server (`src/tools.ts` + `src/db/*.ts` + `src/vector/*.ts`)** — `buildMcpServer({ db, store, embed })` registers all tools on an `McpServer` from `@modelcontextprotocol/sdk`. Tools are thin wrappers: validate inputs with Zod (`DateStr` enforces ISO `YYYY-MM-DD`), call a `src/db/*.ts` helper, return `ok(data)` or `fail(err)`. The DB helpers own all SQL and domain validation (e.g. `end_date >= start_date`, "not found: …" errors via `ToolError`). Row-to-domain conversion lives in `src/db/schema.ts` (`rowToHabit`, `rowToCheckIn`) — snake_case in SQL, camelCase in domain types; tools re-expose snake_case in their JSON schemas.

### Data model (`migrations/0001_init.sql`)

- `habits` — id, name, description, start_date, optional end_date.
- `days` — one row per date with a free-text `comment` (primary key is the date).
- `check_ins` — composite PK `(habit_id, date)`, `done` as INTEGER 0/1, optional `note`. Cascades on habit delete.

A "day" in the API is a synthetic join of the `days` row (may be absent ⇒ empty comment) plus all `check_ins` for that date. `listDays` returns only dates that have *either* a comment or at least one check-in.

### Vector search (`src/vector/*.ts`)

All four free-form text fields (`habits.name`, `habits.description`, `days.comment`, `check_ins.note`) are embedded into a Cloudflare Vectorize index (binding `VECTORIZE`) using Workers AI (binding `AI`, model `@cf/baai/bge-m3`, 1024-dim, cosine). Long fields are split into overlapping chunks by `src/vector/chunker.ts` (≈1500 chars per chunk, 200-char overlap, breaks on paragraph/sentence boundaries) — there is no upper bound on field length.

Vector IDs combine a deterministic source ID with a chunk index: `habit:{id}:name:{i}`, `habit:{id}:description:{i}`, `day:{date}:comment:{i}`, `checkin:{habit_id}:{date}:note:{i}`. Metadata carries `{ kind, habit_id?, date?, chunk_index }` for filtering and for parsing IDs back into D1 lookups. The `text_chunks` D1 table (migration `0002_text_chunks.sql`) tracks `chunk_count` per source ID — this is the source of truth for which chunk vectors should exist, used to delete orphaned chunks when a field shrinks and to purge cleanly on delete.

Sync is **online, best-effort** and **self-healing under partial failure**. The order on every write is: (1) delete orphan chunk vectors `[newCount..priorCount-1]` if the field shrank; (2) upsert all current chunk vectors `[0..newCount-1]`; (3) update `text_chunks` to `newCount`. Any partial failure leaves state where the next sync can re-derive the correct shape, and `reindex_embeddings` recomputes everything from scratch (also cleaning up orphans left by past failures). Sync failures are logged but **never fail the write**.

The `search_text` tool embeds the query, queries Vectorize with over-fetch (`requested * 4`), then **dedupes to one entry per source field** (best-scoring chunk wins). On hydration, the source field is re-chunked deterministically with the same chunker so the matching chunk text can be returned as the `snippet`. Stale matches whose D1 row has been deleted are silently skipped.

In tests, `buildMcpServer` is given an in-memory `VectorStore` and a deterministic hash-based `EmbeddingProvider` from `test/vector-stub.ts` via `testContext()` in `test/helpers.ts`. No Workers AI or Vectorize calls are made offline.

### Error contract

DB helpers throw `ToolError` for expected failures; `fail()` in `tools.ts` converts any error to `{ content, isError: true }` MCP responses. "not found:" prefix is used to signal missing resources (see `isNotFoundError`).

## Testing

`vitest.config.ts` uses `@cloudflare/vitest-pool-workers` to run tests inside Miniflare with a real SQLite-backed D1 and in-memory KV. `test/apply-migrations.ts` runs `beforeEach` — it reapplies migrations, truncates all tables, resets `sqlite_sequence`, and clears `OAUTH_KV`. Tests import `env` from `cloudflare:test` and use `test/helpers.ts` (`db()`, `makeHabit()`, `testContext()`).

`AUTH_PASSWORD` is bound to `"test-password"` in the test env.

## Conventions

- Tools accept/return **snake_case** JSON; internal TS uses **camelCase**. Convert at the tool boundary (see how `habit_id` → `habitId` in `tools.ts`).
- Date validation: always route through `DateStr` (Zod) at the tool edge and `assertIsoDate` inside DB helpers — do not trust callers.
- Timestamps are written by the app via `nowIso()` (not SQL `DEFAULT`) for updates, so `updated_at` reflects the application clock.
- `tsconfig.json` has `noUncheckedIndexedAccess: true` — array/object index access is `T | undefined`. Handle it.
- Module resolution is `bundler` with explicit `.js` extensions in imports (even though sources are `.ts`). Keep that pattern when adding files.
