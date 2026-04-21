import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  createHabit,
  deleteHabit,
  getHabit,
  listHabits,
  updateHabit,
} from "./db/habits.js";
import {
  buildUpsertCheckInStatement,
  deleteCheckIn,
  getCheckIn,
  listCheckInDatesForHabit,
  upsertCheckIn,
} from "./db/check-ins.js";
import {
  buildSetDayCommentStatement,
  deleteDayComment,
  getDay,
  listDays,
  setDayComment,
} from "./db/days.js";
import { isIsoDate } from "./util/date.js";
import { ToolError } from "./util/errors.js";
import { chunkText } from "./vector/chunker.js";
import {
  KINDS,
  type EmbeddingProvider,
  type Kind,
  type VectorStore,
} from "./vector/types.js";
import {
  bestEffort,
  decodeCursor,
  encodeCursor,
  freshCursor,
  parseVectorId,
  purgeCheckIn,
  purgeDayComment,
  purgeHabit,
  reindexStep,
  syncCheckInNote,
  syncDayComment,
  syncHabit,
  type SyncCtx,
} from "./vector/sync.js";

const DateStr = z
  .string()
  .refine(isIsoDate, { message: "must be ISO date YYYY-MM-DD" });

const KindEnum = z.enum(KINDS);

export interface McpContext {
  db: D1Database;
  store: VectorStore;
  embed: EmbeddingProvider;
}

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function fail(err: unknown) {
  const message =
    err instanceof ToolError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

export function buildMcpServer(ctx: McpContext): McpServer {
  const { db, store, embed } = ctx;
  const sctx: SyncCtx = { db, store, embed };

  const server = new McpServer(
    { name: "habit-mcp", version: "0.1.0" },
    { capabilities: { tools: {}, prompts: {} } },
  );

  server.registerTool(
    "list_habits",
    {
      title: "List habits",
      description:
        "List all habits. If `active_on` is supplied, only habits whose date range covers that day are returned.",
      inputSchema: { active_on: DateStr.optional() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ active_on }) => {
      try {
        const habits = await listHabits(db, { activeOn: active_on });
        return ok({ habits });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_habit",
    {
      title: "Get habit",
      description: "Fetch a single habit by id.",
      inputSchema: { id: z.number().int().positive() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      try {
        return ok({ habit: await getHabit(db, id) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_habit",
    {
      title: "Create habit",
      description: "Create a new habit with a start date and optional end date.",
      inputSchema: {
        name: z.string().min(1),
        description: z.string().nullish(),
        start_date: DateStr,
        end_date: DateStr.nullish(),
      },
    },
    async ({ name, description, start_date, end_date }) => {
      try {
        const habit = await createHabit(db, {
          name,
          description: description ?? null,
          startDate: start_date,
          endDate: end_date ?? null,
        });
        await bestEffort("syncHabit.create", () => syncHabit(sctx, habit));
        return ok({ habit });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_habit",
    {
      title: "Update habit",
      description:
        "Update fields on a habit. Omitted fields are left unchanged; pass `end_date: null` to clear an end date.",
      inputSchema: {
        id: z.number().int().positive(),
        name: z.string().min(1).optional(),
        description: z.string().nullish(),
        start_date: DateStr.optional(),
        end_date: DateStr.nullish(),
      },
    },
    async ({ id, name, description, start_date, end_date }) => {
      try {
        const habit = await updateHabit(db, id, {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(start_date !== undefined ? { startDate: start_date } : {}),
          ...(end_date !== undefined ? { endDate: end_date } : {}),
        });
        await bestEffort("syncHabit.update", () => syncHabit(sctx, habit));
        return ok({ habit });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_habit",
    {
      title: "Delete habit",
      description: "Delete a habit and all of its check-ins.",
      inputSchema: { id: z.number().int().positive() },
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ id }) => {
      try {
        const checkInDates = await listCheckInDatesForHabit(db, id);
        await deleteHabit(db, id);
        await bestEffort("purgeHabit", () =>
          purgeHabit(sctx, id, checkInDates),
        );
        return ok({ deleted: id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_days",
    {
      title: "List days",
      description:
        "List every date in [from, to] that has either a day comment or at least one check-in. Each entry contains the date's free-text comment and its check-ins.",
      inputSchema: { from: DateStr, to: DateStr },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ from, to }) => {
      try {
        const days = await listDays(db, { from, to });
        return ok({ days });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "upsert_check_in",
    {
      title: "Record a check-in",
      description:
        "Create or update a check-in for a habit on a specific date. `done` defaults to true.",
      inputSchema: {
        habit_id: z.number().int().positive(),
        date: DateStr,
        done: z.boolean().optional(),
        note: z.string().nullish(),
      },
    },
    async ({ habit_id, date, done, note }) => {
      try {
        const checkIn = await upsertCheckIn(db, {
          habitId: habit_id,
          date,
          ...(done !== undefined ? { done } : {}),
          ...(note !== undefined ? { note } : {}),
        });
        await bestEffort("syncCheckInNote", () =>
          syncCheckInNote(sctx, checkIn.habitId, checkIn.date, checkIn.note),
        );
        return ok({ check_in: checkIn });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_check_in",
    {
      title: "Delete check-in",
      description: "Remove a check-in for a given habit and date.",
      inputSchema: {
        habit_id: z.number().int().positive(),
        date: DateStr,
      },
      annotations: { destructiveHint: true },
    },
    async ({ habit_id, date }) => {
      try {
        await deleteCheckIn(db, habit_id, date);
        await bestEffort("purgeCheckIn", () =>
          purgeCheckIn(sctx, habit_id, date),
        );
        return ok({ deleted: { habit_id, date } });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_day",
    {
      title: "Get day",
      description:
        "Return the day's free-text comment together with all check-ins recorded for that day.",
      inputSchema: { date: DateStr },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ date }) => {
      try {
        return ok({ day: await getDay(db, date) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "set_day_comment",
    {
      title: "Set day comment",
      description: "Set (create or update) the free-text comment for a date.",
      inputSchema: { date: DateStr, comment: z.string() },
    },
    async ({ date, comment }) => {
      try {
        const day = await setDayComment(db, date, comment);
        await bestEffort("syncDayComment", () =>
          syncDayComment(sctx, date, comment),
        );
        return ok({ day });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_day_comment",
    {
      title: "Delete day comment",
      description: "Remove the free-text comment for a date.",
      inputSchema: { date: DateStr },
      annotations: { destructiveHint: true },
    },
    async ({ date }) => {
      try {
        await deleteDayComment(db, date);
        await bestEffort("purgeDayComment", () => purgeDayComment(sctx, date));
        return ok({ deleted: date });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "record_day",
    {
      title: "Record a whole day",
      description:
        "Convenience tool: set the day comment (optional) and upsert any number of check-ins in a single call.",
      inputSchema: {
        date: DateStr,
        comment: z.string().optional(),
        check_ins: z
          .array(
            z.object({
              habit_id: z.number().int().positive(),
              done: z.boolean().optional(),
              note: z.string().nullish(),
            }),
          )
          .optional(),
      },
    },
    async ({ date, comment, check_ins }) => {
      try {
        const statements: D1PreparedStatement[] = [];
        if (comment !== undefined) {
          statements.push(buildSetDayCommentStatement(db, date, comment));
        }
        for (const ci of check_ins ?? []) {
          statements.push(
            buildUpsertCheckInStatement(db, {
              habitId: ci.habit_id,
              date,
              ...(ci.done !== undefined ? { done: ci.done } : {}),
              ...(ci.note !== undefined ? { note: ci.note } : {}),
            }),
          );
        }
        if (statements.length > 0) {
          await db.batch(statements);
        }
        if (comment !== undefined) {
          await bestEffort("syncDayComment.record", () =>
            syncDayComment(sctx, date, comment),
          );
        }
        for (const ci of check_ins ?? []) {
          if (ci.note !== undefined) {
            const noteVal = ci.note;
            await bestEffort("syncCheckInNote.record", () =>
              syncCheckInNote(sctx, ci.habit_id, date, noteVal),
            );
          }
        }
        return ok({ day: await getDay(db, date) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "search_text",
    {
      title: "Semantic text search",
      description:
        "Semantic search across all free-form text fields (habit names, habit descriptions, day comments, check-in notes). Long fields are split into chunks; results are deduped to one entry per source field, returning the best-scoring chunk as the snippet. Optionally filter by `kinds`.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
        kinds: z.array(KindEnum).min(1).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query, limit, kinds }) => {
      try {
        const vecs = await embed.embed([query]);
        const vec = vecs[0];
        if (!vec) throw new ToolError("failed to embed query");
        const requested = limit ?? 10;
        const filter =
          kinds && kinds.length > 0
            ? ({ kind: { $in: kinds as Kind[] } } as Record<string, unknown>)
            : undefined;
        const matches = await store.query(vec, {
          // Over-fetch since multiple chunks of one source may both match;
          // we'll dedupe to one entry per source.
          topK: Math.min(requested * 4, 200),
          ...(filter ? { filter } : {}),
        });

        const bestPerSource = new Map<
          string,
          { parsed: ReturnType<typeof parseVectorId>; score: number; id: string }
        >();
        for (const m of matches) {
          const parsed = parseVectorId(m.id);
          if (!parsed) continue;
          const prior = bestPerSource.get(parsed.sourceId);
          if (!prior || m.score > prior.score) {
            bestPerSource.set(parsed.sourceId, { parsed, score: m.score, id: m.id });
          }
        }

        const ranked = [...bestPerSource.values()].sort(
          (a, b) => b.score - a.score,
        );

        const hydrated = await Promise.all(
          ranked.map(async ({ parsed, score, id }) => {
            if (!parsed) return null;
            const base = { id, kind: parsed.kind, score };
            if (
              parsed.kind === "habit_name" ||
              parsed.kind === "habit_description"
            ) {
              if (parsed.habitId === undefined) return null;
              try {
                const habit = await getHabit(db, parsed.habitId);
                const fullText =
                  parsed.kind === "habit_name"
                    ? habit.name
                    : habit.description ?? "";
                const snippet = pickChunk(fullText, parsed.chunkIndex);
                if (!snippet) return null;
                return {
                  ...base,
                  habit_id: habit.id,
                  chunk_index: parsed.chunkIndex,
                  snippet,
                  habit,
                };
              } catch {
                return null; // stale vector
              }
            }
            if (parsed.kind === "day_comment") {
              if (!parsed.date) return null;
              const day = await getDay(db, parsed.date);
              if (!day.comment) return null;
              const snippet = pickChunk(day.comment, parsed.chunkIndex);
              if (!snippet) return null;
              return {
                ...base,
                date: parsed.date,
                chunk_index: parsed.chunkIndex,
                snippet,
                day,
              };
            }
            if (parsed.kind === "check_in_note") {
              if (parsed.habitId === undefined || !parsed.date) return null;
              const ci = await getCheckIn(db, parsed.habitId, parsed.date);
              if (!ci || !ci.note) return null;
              const snippet = pickChunk(ci.note, parsed.chunkIndex);
              if (!snippet) return null;
              return {
                ...base,
                habit_id: parsed.habitId,
                date: parsed.date,
                chunk_index: parsed.chunkIndex,
                snippet,
                check_in: ci,
              };
            }
            return null;
          }),
        );
        const results = hydrated
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .slice(0, requested);

        return ok({ results });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "reindex_embeddings",
    {
      title: "Rebuild vector index (paginated)",
      description:
        "Recompute embeddings for habit names, descriptions, day comments, and check-in notes in small batches to stay under the per-invocation subrequest limit. Omit `cursor` on the first call. If the response has `done: false`, call again with `{ cursor: <next_cursor> }` until `done: true`. Also deletes orphaned chunk vectors. Idempotent. Note: `limit: 0` is a no-op that echoes the cursor (useful for progress inspection only); any loop that drives a full reindex must use `limit >= 1` or it will never terminate.",
      inputSchema: {
        cursor: z.string().optional(),
        limit: z.number().int().min(0).max(25).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ cursor, limit }) => {
      try {
        const startCursor = cursor ? decodeCursor(cursor) : freshCursor();
        const effectiveLimit = limit ?? 6;
        const { next, processed, phase } = await reindexStep(
          sctx,
          startCursor,
          effectiveLimit,
        );
        const done = next.phase === "done";
        const payload: Record<string, unknown> = {
          done,
          phase,
          processed,
          totals: next.totals,
        };
        if (!done) payload.next_cursor = encodeCursor(next);
        return ok(payload);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerPrompt(
    "run_full_reindex",
    {
      title: "Rebuild vector index (paginated)",
      description:
        "Drive reindex_embeddings in a loop until done, staying under the per-invocation subrequest limit. Use for first-deploy indexing, after changing embedding dimensions, or whenever a full rebuild is requested.",
      argsSchema: {
        limit: z
          .string()
          .regex(/^\d+$/, "limit must be an integer")
          .refine(
            (s) => {
              const n = Number.parseInt(s, 10);
              return n >= 1 && n <= 25;
            },
            { message: "limit must be between 1 and 25" },
          )
          .optional(),
      },
    },
    ({ limit }) => {
      const parsed = limit !== undefined ? Number.parseInt(limit, 10) : undefined;
      const firstCall =
        parsed !== undefined ? `\`{ limit: ${parsed} }\`` : "`{}`";
      const subsequent =
        parsed !== undefined
          ? ` and \`{ limit: ${parsed} }\``
          : " (optionally raising `limit` up to 25 if prior calls succeed)";
      const text = [
        "Rebuild the full vector index by calling the `reindex_embeddings` tool in a loop:",
        "",
        `1. First call: pass ${firstCall}.`,
        `2. On each response, if \`done === false\`, call again with \`{ cursor: <next_cursor> }\`${subsequent}.`,
        "3. If a call returns `isError: true` with a subrequest-limit message, retry the same cursor with `limit` halved (floor 3).",
        "4. Between calls, print one progress line: `phase=<phase> processed=<n> totals.chunks_upserted=<n>`.",
        "5. When `done === true`, print the final `totals` and stop.",
      ].join("\n");
      return {
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text },
          },
        ],
      };
    },
  );

  return server;
}

function pickChunk(fullText: string, chunkIndex: number): string {
  const chunks = chunkText(fullText);
  return chunks[chunkIndex] ?? chunks[0] ?? fullText;
}
