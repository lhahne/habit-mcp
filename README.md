# habit-mcp

Single-user habit tracker exposed as a remote MCP server, running on
Cloudflare Workers + D1.

Designed to be added to **claude.ai** via *Settings → Connectors → Add
custom connector*. Authentication is a minimal one-password OAuth flow
(no account system): pick one password, paste the server URL into
claude.ai, enter the password once to authorize.

## Features

- Habits with `name`, optional `description`, `start_date`, and optional
  `end_date`.
- Per-date day rows holding free-text `comment`, optional `weight`,
  free-text `exercise`, and free-text `weekly_comment`, plus sparse
  per-habit check-ins (`done` boolean + optional `note`).
- CRUD tools for habits, check-ins, and every day field. A `record_day`
  convenience tool upserts any combination of the day's fields and any
  number of check-ins in one call.
- Semantic search (`search_text`) across all free-form text fields
  (habit names + descriptions, day comments, exercises, weekly comments,
  and check-in notes), backed by a Cloudflare Vectorize index with
  Workers AI embeddings. `reindex_embeddings` rebuilds the index in
  paginated batches.
- Row version history: every overwrite or delete on `habits`, `days`, or
  `check_ins` is archived in a parallel `*_history` table via SQLite
  triggers, so prior text is recoverable.
- Streamable HTTP MCP transport at `/mcp` (the one claude.ai speaks).
- OAuth 2.1 + PKCE + Dynamic Client Registration, gated by a single
  password (`AUTH_PASSWORD` Worker secret).

## Project layout

```
migrations/                # D1 schema + incremental migrations
src/db/*.ts                # habits, check-ins, days query helpers
src/vector/*.ts            # chunking, embeddings, Vectorize sync, reindex
src/tools.ts               # MCP tool registrations
src/auth/handler.ts        # single-password /authorize UI
src/index.ts               # OAuthProvider wrapping MCP handler
test/                      # vitest suite (runs fully offline)
```

## Local development (no network required)

```sh
pnpm install
cp .dev.vars.example .dev.vars       # set AUTH_PASSWORD
pnpm migrate:local
pnpm dev                             # http://localhost:8787
```

Point the [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
at `http://localhost:8787/mcp`. It walks the OAuth flow and prompts for
the password.

## Tests

```sh
pnpm test
```

Runs the full suite inside Miniflare with an isolated SQLite-backed D1
database and an in-memory KV. No Cloudflare account or network access
required.

## Deploy

```sh
wrangler d1 create habit-mcp
# copy the returned database_id into wrangler.jsonc
wrangler kv namespace create OAUTH_KV
# copy the returned id into wrangler.jsonc
pnpm exec wrangler vectorize create habit-mcp-text \
  --dimensions=1024 --metric=cosine
wrangler secret put AUTH_PASSWORD
pnpm migrate:remote
pnpm deploy
```

The Vectorize index only needs to be created once. If the embedding
model or its dimensions change later, recreate the index
(`vectorize delete` then `create`) and call the `reindex_embeddings`
tool to repopulate.

Then in claude.ai → *Settings → Connectors → Add custom connector* enter
`https://habit-mcp.<your-account>.workers.dev/mcp`, complete the OAuth
redirect by entering the password, and the habit tools appear in chat.

## Tools exposed

| Tool                        | Purpose                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `list_habits`               | List habits, optionally filtered by `active_on`.                                         |
| `get_habit`                 | Fetch one habit by id.                                                                   |
| `create_habit`              | Create a habit.                                                                          |
| `update_habit`              | Patch habit fields.                                                                      |
| `delete_habit`              | Delete habit (cascades to check-ins).                                                    |
| `upsert_check_in`           | Create or update a check-in.                                                             |
| `delete_check_in`           | Remove a check-in.                                                                       |
| `get_day`                   | Day comment, weight, exercise, weekly comment, plus joined check-ins for a date.         |
| `list_days`                 | Days in a range with any field set or any check-in, each with all day fields + check-ins. |
| `set_day_comment`           | Create or update the free-text comment for a date.                                       |
| `delete_day_comment`        | Clear the day comment (row preserved).                                                   |
| `set_day_weight`            | Create or update the body-weight reading for a date.                                     |
| `delete_day_weight`         | Clear the weight reading (row preserved).                                                |
| `set_day_exercise`          | Create or update the free-text exercise log for a date.                                  |
| `delete_day_exercise`       | Clear the exercise log (row preserved).                                                  |
| `set_day_weekly_comment`    | Create or update the free-text weekly comment for a date.                                |
| `delete_day_weekly_comment` | Clear the weekly comment (row preserved).                                                |
| `record_day`                | Set any combination of comment, weight, exercise, weekly comment, and check-ins at once. |
| `search_text`               | Semantic search across all free-form text fields, optionally filtered by `kinds`.        |
| `reindex_embeddings`        | Rebuild the vector index in paginated batches; also purges orphaned chunks.              |
