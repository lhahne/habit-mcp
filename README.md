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
- Per-day `comment` field (free text) and sparse per-habit check-ins
  (`done` boolean + optional `note`).
- CRUD tools for habits, check-ins, and day comments. A `record_day`
  convenience tool upserts a comment and any number of check-ins in one
  call.
- Streamable HTTP MCP transport at `/mcp` (the one claude.ai speaks).
- OAuth 2.1 + PKCE + Dynamic Client Registration, gated by a single
  password (`AUTH_PASSWORD` Worker secret).

## Project layout

```
migrations/0001_init.sql   # D1 schema
src/db/*.ts                # habits, check-ins, days query helpers
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
wrangler secret put AUTH_PASSWORD
pnpm migrate:remote
pnpm deploy
```

Then in claude.ai → *Settings → Connectors → Add custom connector* enter
`https://habit-mcp.<your-account>.workers.dev/mcp`, complete the OAuth
redirect by entering the password, and the habit tools appear in chat.

## Tools exposed

| Tool                 | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `list_habits`        | List habits, optionally filtered by `active_on`.   |
| `get_habit`          | Fetch one habit by id.                             |
| `create_habit`       | Create a habit.                                    |
| `update_habit`       | Patch habit fields.                                |
| `delete_habit`       | Delete habit (cascades to check-ins).              |
| `upsert_check_in`    | Create or update a check-in.                       |
| `delete_check_in`    | Remove a check-in.                                 |
| `get_day`            | Day comment plus joined check-ins for a date.      |
| `list_days`          | Days in a range, each with comment + check-ins.    |
| `set_day_comment`    | Create or update the comment for a date.           |
| `delete_day_comment` | Remove the day comment.                            |
| `record_day`         | Set the day comment and bulk-upsert check-ins.     |
