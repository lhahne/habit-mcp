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
  deleteCheckIn,
  listCheckIns,
  upsertCheckIn,
} from "./db/check-ins.js";
import { deleteDayComment, getDay, setDayComment } from "./db/days.js";
import { ToolError } from "./util/errors.js";

const DateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO date YYYY-MM-DD");

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

export function buildMcpServer(db: D1Database): McpServer {
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
        await deleteHabit(db, id);
        return ok({ deleted: id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_check_ins",
    {
      title: "List check-ins",
      description:
        "List check-ins, optionally filtered by habit_id and/or a date range.",
      inputSchema: {
        habit_id: z.number().int().positive().optional(),
        from: DateStr.optional(),
        to: DateStr.optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ habit_id, from, to }) => {
      try {
        const checkIns = await listCheckIns(db, {
          ...(habit_id !== undefined ? { habitId: habit_id } : {}),
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {}),
        });
        return ok({ check_ins: checkIns });
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
        return ok({ day: await setDayComment(db, date, comment) });
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
        if (comment !== undefined) {
          await setDayComment(db, date, comment);
        }
        for (const ci of check_ins ?? []) {
          await upsertCheckIn(db, {
            habitId: ci.habit_id,
            date,
            ...(ci.done !== undefined ? { done: ci.done } : {}),
            ...(ci.note !== undefined ? { note: ci.note } : {}),
          });
        }
        return ok({ day: await getDay(db, date) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}
