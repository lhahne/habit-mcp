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
  listAllCheckInsWithNotes,
  listCheckInDatesForHabit,
  upsertCheckIn,
} from "./db/check-ins.js";
import {
  buildSetDayCommentStatement,
  deleteDayComment,
  getDay,
  listAllDaysWithComments,
  listDays,
  setDayComment,
} from "./db/days.js";
import { isIsoDate } from "./util/date.js";
import { ToolError } from "./util/errors.js";
import { KINDS, type EmbeddingProvider, type Kind, type VectorStore } from "./vector/types.js";
import {
  bestEffort,
  parseVectorId,
  purgeCheckIn,
  purgeDayComment,
  purgeHabit,
  syncCheckInNote,
  syncDayComment,
  syncHabit,
  vectorIdForCheckInNote,
  vectorIdForDayComment,
  vectorIdForHabitDescription,
  vectorIdForHabitName,
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

  const server = new McpServer(
    { name: "habit-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
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
        await bestEffort("syncHabit.create", () => syncHabit(store, embed, habit));
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
        await bestEffort("syncHabit.update", () => syncHabit(store, embed, habit));
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
          purgeHabit(store, id, checkInDates),
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
          syncCheckInNote(store, embed, checkIn.habitId, checkIn.date, checkIn.note),
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
          purgeCheckIn(store, habit_id, date),
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
          syncDayComment(store, embed, date, comment),
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
        await bestEffort("purgeDayComment", () =>
          purgeDayComment(store, date),
        );
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
            syncDayComment(store, embed, date, comment),
          );
        }
        for (const ci of check_ins ?? []) {
          if (ci.note !== undefined) {
            const noteVal = ci.note;
            await bestEffort("syncCheckInNote.record", () =>
              syncCheckInNote(store, embed, ci.habit_id, date, noteVal),
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
        "Semantic search across all free-form text fields (habit names, habit descriptions, day comments, check-in notes). Returns a mixed, ranked list of matches. Optionally filter by `kinds`.",
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
        const filter =
          kinds && kinds.length > 0
            ? ({ kind: { $in: kinds as Kind[] } } as Record<string, unknown>)
            : undefined;
        const matches = await store.query(vec, {
          topK: limit ?? 10,
          ...(filter ? { filter } : {}),
        });

        const results = [];
        for (const m of matches) {
          const parsed = parseVectorId(m.id);
          if (!parsed) continue;
          const base = { id: m.id, kind: parsed.kind, score: m.score };
          if (parsed.kind === "habit_name" || parsed.kind === "habit_description") {
            if (parsed.habitId === undefined) continue;
            try {
              const habit = await getHabit(db, parsed.habitId);
              const snippet =
                parsed.kind === "habit_name" ? habit.name : habit.description ?? "";
              results.push({
                ...base,
                habit_id: habit.id,
                snippet,
                habit,
              });
            } catch {
              // stale vector, skip
            }
          } else if (parsed.kind === "day_comment") {
            if (!parsed.date) continue;
            const day = await getDay(db, parsed.date);
            if (!day.comment) continue;
            results.push({
              ...base,
              date: parsed.date,
              snippet: day.comment,
              day,
            });
          } else if (parsed.kind === "check_in_note") {
            if (parsed.habitId === undefined || !parsed.date) continue;
            const ci = await getCheckIn(db, parsed.habitId, parsed.date);
            if (!ci || !ci.note) continue;
            results.push({
              ...base,
              habit_id: parsed.habitId,
              date: parsed.date,
              snippet: ci.note,
              check_in: ci,
            });
          }
        }

        return ok({ results });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "reindex_embeddings",
    {
      title: "Rebuild vector index",
      description:
        "Recompute and upsert embeddings for all habit names, descriptions, day comments, and check-in notes. Safe to call anytime; overwrites by deterministic id.",
      inputSchema: {},
      annotations: { idempotentHint: true },
    },
    async () => {
      try {
        const habits = await listHabits(db);
        const days = await listAllDaysWithComments(db);
        const notes = await listAllCheckInsWithNotes(db);

        let habitNames = 0;
        let habitDescriptions = 0;
        let dayComments = 0;
        let checkInNotes = 0;

        const BATCH = 32;
        const texts: string[] = [];
        const ids: string[] = [];
        const metas: { kind: Kind; habit_id?: number; date?: string }[] = [];

        const flush = async () => {
          if (texts.length === 0) return;
          const vectors = await embed.embed(texts);
          await store.upsert(
            texts.map((_, i) => {
              const values = vectors[i];
              const id = ids[i]!;
              const metadata = metas[i]!;
              if (!values) throw new ToolError(`missing embedding for ${id}`);
              return { id, values, metadata };
            }),
          );
          texts.length = 0;
          ids.length = 0;
          metas.length = 0;
        };

        const push = async (
          id: string,
          text: string,
          metadata: { kind: Kind; habit_id?: number; date?: string },
        ) => {
          texts.push(text);
          ids.push(id);
          metas.push(metadata);
          if (texts.length >= BATCH) await flush();
        };

        for (const h of habits) {
          if (h.name && h.name.trim() !== "") {
            await push(vectorIdForHabitName(h.id), h.name, {
              kind: "habit_name",
              habit_id: h.id,
            });
            habitNames++;
          }
          if (h.description && h.description.trim() !== "") {
            await push(vectorIdForHabitDescription(h.id), h.description, {
              kind: "habit_description",
              habit_id: h.id,
            });
            habitDescriptions++;
          }
        }
        for (const d of days) {
          await push(vectorIdForDayComment(d.date), d.comment, {
            kind: "day_comment",
            date: d.date,
          });
          dayComments++;
        }
        for (const n of notes) {
          if (!n.note) continue;
          await push(vectorIdForCheckInNote(n.habitId, n.date), n.note, {
            kind: "check_in_note",
            habit_id: n.habitId,
            date: n.date,
          });
          checkInNotes++;
        }
        await flush();

        return ok({
          reindexed: {
            habit_names: habitNames,
            habit_descriptions: habitDescriptions,
            day_comments: dayComments,
            check_in_notes: checkInNotes,
          },
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}
