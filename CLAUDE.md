# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev                # wrangler dev on http://localhost:8787
npm test                   # full vitest suite (offline, Miniflare-backed)
npm run test:watch         # vitest in watch mode
npx vitest run test/habits.test.ts   # single test file
npx vitest run -t "creates a habit"  # single test by name
npm run typecheck          # tsc --noEmit
npm run migrate:local      # apply migrations to local D1 (needed before `npm run dev`)
npm run migrate:remote     # apply migrations to deployed D1
npm run deploy             # wrangler deploy
```

Local setup: `cp .dev.vars.example .dev.vars` and set `AUTH_PASSWORD` before `npm run dev`.

## Architecture

This is a single-user **MCP server** running on **Cloudflare Workers + D1**, deployed as a remote connector for claude.ai. Three layers matter:

1. **OAuth wrapper (`src/index.ts`)** — `@cloudflare/workers-oauth-provider` intercepts all requests. Requests to `/mcp` go through `mcpApiHandler` only after bearer-token validation. Everything else (including `/authorize`) goes to `authHandler`. The provider injects an `env.OAUTH_PROVIDER` binding used inside the auth handler to complete the flow.

2. **Auth handler (`src/auth/handler.ts`)** — implements a single-password OAuth 2.1 + PKCE flow. `GET /authorize` renders a login page; `POST /authorize` compares the submitted password against `env.AUTH_PASSWORD` using a SHA-256 timing-safe compare, then calls `OAUTH_PROVIDER.completeAuthorization` with a hard-coded `userId: "owner"`. There is no user table — this is deliberately single-user.

3. **MCP server (`src/tools.ts` + `src/db/*.ts`)** — `buildMcpServer(db)` registers all tools on an `McpServer` from `@modelcontextprotocol/sdk`. Tools are thin wrappers: validate inputs with Zod (`DateStr` enforces ISO `YYYY-MM-DD`), call a `src/db/*.ts` helper, return `ok(data)` or `fail(err)`. The DB helpers own all SQL and domain validation (e.g. `end_date >= start_date`, "not found: …" errors via `ToolError`). Row-to-domain conversion lives in `src/db/schema.ts` (`rowToHabit`, `rowToCheckIn`) — snake_case in SQL, camelCase in domain types; tools re-expose snake_case in their JSON schemas.

### Data model (`migrations/0001_init.sql`)

- `habits` — id, name, description, start_date, optional end_date.
- `days` — one row per date with a free-text `comment` (primary key is the date).
- `check_ins` — composite PK `(habit_id, date)`, `done` as INTEGER 0/1, optional `note`. Cascades on habit delete.

A "day" in the API is a synthetic join of the `days` row (may be absent ⇒ empty comment) plus all `check_ins` for that date. `listDays` returns only dates that have *either* a comment or at least one check-in.

### Error contract

DB helpers throw `ToolError` for expected failures; `fail()` in `tools.ts` converts any error to `{ content, isError: true }` MCP responses. "not found:" prefix is used to signal missing resources (see `isNotFoundError`).

## Testing

`vitest.config.ts` uses `@cloudflare/vitest-pool-workers` to run tests inside Miniflare with a real SQLite-backed D1 and in-memory KV. `test/apply-migrations.ts` runs `beforeEach` — it reapplies migrations, truncates all tables, resets `sqlite_sequence`, and clears `OAUTH_KV`. Tests import `env` from `cloudflare:test` and use `test/helpers.ts` (`db()`, `makeHabit()`).

`AUTH_PASSWORD` is bound to `"test-password"` in the test env.

## Conventions

- Tools accept/return **snake_case** JSON; internal TS uses **camelCase**. Convert at the tool boundary (see how `habit_id` → `habitId` in `tools.ts`).
- Date validation: always route through `DateStr` (Zod) at the tool edge and `assertIsoDate` inside DB helpers — do not trust callers.
- Timestamps are written by the app via `nowIso()` (not SQL `DEFAULT`) for updates, so `updated_at` reflects the application clock.
- `tsconfig.json` has `noUncheckedIndexedAccess: true` — array/object index access is `T | undefined`. Handle it.
- Module resolution is `bundler` with explicit `.js` extensions in imports (even though sources are `.ts`). Keep that pattern when adding files.
