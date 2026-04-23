import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { buildMcpServer } from "../src/tools.js";
import { testContext } from "./helpers.js";

async function connect(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildMcpServer(testContext());
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: {} },
  );
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function call<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ raw: CallToolResult; data: T; isError: boolean }> {
  const raw = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const isError = raw.isError === true;
  const structured = raw.structuredContent as T | undefined;
  return {
    raw,
    isError,
    data: structured ?? (undefined as T),
  };
}

describe("mcp tools", () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const conn = await connect();
    client = conn.client;
    close = conn.close;
  });

  afterEach(async () => {
    await close();
  });

  it("lists registered tools", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "create_habit",
        "delete_check_in",
        "delete_day_comment",
        "delete_day_exercise",
        "delete_day_weight",
        "delete_habit",
        "get_day",
        "get_habit",
        "list_days",
        "list_habits",
        "record_day",
        "reindex_embeddings",
        "search_text",
        "set_day_comment",
        "set_day_exercise",
        "set_day_weight",
        "update_habit",
        "upsert_check_in",
      ].sort(),
    );
  });

  it("runs end-to-end: create habit, check in, record day, query", async () => {
    const created = await call<{ habit: { id: number; name: string } }>(
      client,
      "create_habit",
      { name: "Floss", start_date: "2026-04-01" },
    );
    expect(created.isError).toBe(false);
    const habitId = created.data.habit.id;

    const checkIn = await call(client, "upsert_check_in", {
      habit_id: habitId,
      date: "2026-04-10",
      note: "evening",
    });
    expect(checkIn.isError).toBe(false);

    const day = await call<{
      day: { comment: string; checkIns: { note: string | null }[] };
    }>(client, "record_day", {
      date: "2026-04-10",
      comment: "good day",
      check_ins: [{ habit_id: habitId, done: true, note: "after dinner" }],
    });
    expect(day.isError).toBe(false);
    expect(day.data.day.comment).toBe("good day");
    expect(day.data.day.checkIns).toHaveLength(1);
    expect(day.data.day.checkIns[0]!.note).toBe("after dinner");

    const days = await call<{
      days: { date: string; comment: string; checkIns: { note: string | null }[] }[];
    }>(client, "list_days", { from: "2026-04-01", to: "2026-04-30" });
    expect(days.isError).toBe(false);
    expect(days.data.days).toHaveLength(1);
    expect(days.data.days[0]!.date).toBe("2026-04-10");
    expect(days.data.days[0]!.comment).toBe("good day");
    expect(days.data.days[0]!.checkIns[0]!.note).toBe("after dinner");

    const badRange = await call(client, "list_days", {
      from: "2026-04-30",
      to: "2026-04-01",
    });
    expect(badRange.isError).toBe(true);

    const list = await call<{ habits: { id: number }[] }>(
      client,
      "list_habits",
      { active_on: "2026-04-10" },
    );
    expect(list.data.habits.map((h) => h.id)).toEqual([habitId]);

    const none = await call<{ habits: { id: number }[] }>(
      client,
      "list_habits",
      { active_on: "2025-01-01" },
    );
    expect(none.data.habits).toEqual([]);
  });

  it("surfaces validation errors as isError responses", async () => {
    const bad = await call(client, "create_habit", {
      name: "x",
      start_date: "nope",
    });
    expect(bad.isError).toBe(true);
  });

  it("returns an isError response for not-found on update_habit", async () => {
    const r = await call(client, "update_habit", {
      id: 9999,
      name: "whatever",
    });
    expect(r.isError).toBe(true);
  });

  async function makeHabitTool(
    name = "Read",
    extras: Record<string, unknown> = {},
  ): Promise<number> {
    const res = await call<{ habit: { id: number } }>(client, "create_habit", {
      name,
      start_date: "2026-01-01",
      ...extras,
    });
    expect(res.isError).toBe(false);
    return res.data.habit.id;
  }

  it("get_habit returns the habit and errors when missing", async () => {
    const id = await makeHabitTool("Walk");
    const found = await call<{ habit: { id: number; name: string } }>(
      client,
      "get_habit",
      { id },
    );
    expect(found.isError).toBe(false);
    expect(found.data.habit).toMatchObject({ id, name: "Walk" });

    const missing = await call(client, "get_habit", { id: 4242 });
    expect(missing.isError).toBe(true);
  });

  it("update_habit patches fields and clears end_date when null", async () => {
    const id = await makeHabitTool("Stretch", { end_date: "2026-12-31" });
    const patched = await call<{
      habit: { name: string; description: string | null; endDate: string | null };
    }>(client, "update_habit", {
      id,
      name: "Stretch daily",
      description: "10 min",
      end_date: null,
    });
    expect(patched.isError).toBe(false);
    expect(patched.data.habit.name).toBe("Stretch daily");
    expect(patched.data.habit.description).toBe("10 min");
    expect(patched.data.habit.endDate).toBeNull();
  });

  it("delete_habit removes the habit and cascades check-ins", async () => {
    const id = await makeHabitTool("Meditate");
    const ci = await call(client, "upsert_check_in", {
      habit_id: id,
      date: "2026-02-01",
    });
    expect(ci.isError).toBe(false);

    const del = await call<{ deleted: number }>(client, "delete_habit", { id });
    expect(del.isError).toBe(false);
    expect(del.data.deleted).toBe(id);

    const again = await call(client, "delete_habit", { id });
    expect(again.isError).toBe(true);

    const day = await call<{
      day: { checkIns: unknown[] };
    }>(client, "get_day", { date: "2026-02-01" });
    expect(day.data.day.checkIns).toEqual([]);
  });

  it("delete_check_in removes the check-in and errors when missing", async () => {
    const id = await makeHabitTool("Journal");
    await call(client, "upsert_check_in", { habit_id: id, date: "2026-02-02" });

    const del = await call<{ deleted: { habit_id: number; date: string } }>(
      client,
      "delete_check_in",
      { habit_id: id, date: "2026-02-02" },
    );
    expect(del.isError).toBe(false);
    expect(del.data.deleted).toEqual({ habit_id: id, date: "2026-02-02" });

    const again = await call(client, "delete_check_in", {
      habit_id: id,
      date: "2026-02-02",
    });
    expect(again.isError).toBe(true);
  });

  it("get_day returns empty shape for an unknown date", async () => {
    const day = await call<{
      day: {
        date: string;
        comment: string;
        weight: number | null;
        exercise: string;
        checkIns: unknown[];
      };
    }>(client, "get_day", { date: "2030-01-01" });
    expect(day.isError).toBe(false);
    expect(day.data.day).toEqual({
      date: "2030-01-01",
      comment: "",
      weight: null,
      exercise: "",
      checkIns: [],
    });
  });

  it("set_day_comment creates then updates the comment", async () => {
    const created = await call<{ day: { comment: string } }>(
      client,
      "set_day_comment",
      { date: "2026-03-10", comment: "started" },
    );
    expect(created.isError).toBe(false);
    expect(created.data.day.comment).toBe("started");

    const updated = await call<{ day: { comment: string } }>(
      client,
      "set_day_comment",
      { date: "2026-03-10", comment: "finished" },
    );
    expect(updated.data.day.comment).toBe("finished");

    const fetched = await call<{ day: { comment: string } }>(
      client,
      "get_day",
      { date: "2026-03-10" },
    );
    expect(fetched.data.day.comment).toBe("finished");
  });

  it("delete_day_comment clears the comment but preserves the row", async () => {
    await call(client, "set_day_comment", {
      date: "2026-03-11",
      comment: "scratch",
    });

    const del = await call<{ deleted: string }>(
      client,
      "delete_day_comment",
      { date: "2026-03-11" },
    );
    expect(del.isError).toBe(false);
    expect(del.data.deleted).toBe("2026-03-11");

    const fetched = await call<{ day: { comment: string } }>(
      client,
      "get_day",
      { date: "2026-03-11" },
    );
    expect(fetched.data.day.comment).toBe("");

    // Second clear on an existing row is idempotent.
    const again = await call(client, "delete_day_comment", {
      date: "2026-03-11",
    });
    expect(again.isError).toBe(false);

    // But clearing for a date that never had a row errors.
    const missing = await call(client, "delete_day_comment", {
      date: "2026-03-12",
    });
    expect(missing.isError).toBe(true);
  });

  it("set_day_weight / delete_day_weight round-trip", async () => {
    const set = await call<{ day: { weight: number | null } }>(
      client,
      "set_day_weight",
      { date: "2026-03-20", weight: 81.4 },
    );
    expect(set.isError).toBe(false);
    expect(set.data.day.weight).toBe(81.4);

    const updated = await call<{ day: { weight: number | null } }>(
      client,
      "set_day_weight",
      { date: "2026-03-20", weight: 81.2 },
    );
    expect(updated.data.day.weight).toBe(81.2);

    const cleared = await call<{ deleted: string }>(
      client,
      "delete_day_weight",
      { date: "2026-03-20" },
    );
    expect(cleared.isError).toBe(false);

    const fetched = await call<{ day: { weight: number | null } }>(
      client,
      "get_day",
      { date: "2026-03-20" },
    );
    expect(fetched.data.day.weight).toBeNull();

    const missing = await call(client, "delete_day_weight", {
      date: "2026-03-21",
    });
    expect(missing.isError).toBe(true);
  });

  it("set_day_exercise / delete_day_exercise round-trip", async () => {
    const set = await call<{ day: { exercise: string } }>(
      client,
      "set_day_exercise",
      { date: "2026-03-22", exercise: "30 min easy run" },
    );
    expect(set.isError).toBe(false);
    expect(set.data.day.exercise).toBe("30 min easy run");

    const cleared = await call<{ deleted: string }>(
      client,
      "delete_day_exercise",
      { date: "2026-03-22" },
    );
    expect(cleared.isError).toBe(false);

    const fetched = await call<{ day: { exercise: string } }>(
      client,
      "get_day",
      { date: "2026-03-22" },
    );
    expect(fetched.data.day.exercise).toBe("");

    const missing = await call(client, "delete_day_exercise", {
      date: "2026-03-23",
    });
    expect(missing.isError).toBe(true);
  });

  it("record_day writes comment, weight, exercise, and check-ins atomically", async () => {
    const id = await makeHabitTool("Stretch");
    const res = await call<{
      day: {
        comment: string;
        weight: number | null;
        exercise: string;
        checkIns: { habitId: number; note: string | null }[];
      };
    }>(client, "record_day", {
      date: "2026-04-01",
      comment: "solid day",
      weight: 79.9,
      exercise: "yoga 20 min",
      check_ins: [{ habit_id: id, note: "morning" }],
    });
    expect(res.isError).toBe(false);
    expect(res.data.day).toMatchObject({
      comment: "solid day",
      weight: 79.9,
      exercise: "yoga 20 min",
    });
    expect(res.data.day.checkIns).toHaveLength(1);
    expect(res.data.day.checkIns[0]!.note).toBe("morning");

    // weight: null in record_day clears the weight.
    await call(client, "record_day", { date: "2026-04-01", weight: null });
    const fetched = await call<{ day: { weight: number | null } }>(
      client,
      "get_day",
      { date: "2026-04-01" },
    );
    expect(fetched.data.day.weight).toBeNull();
  });
});
