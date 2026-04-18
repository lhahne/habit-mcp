import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { buildMcpServer } from "../src/tools.js";
import { db } from "./helpers.js";

async function connect(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildMcpServer(db());
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
        "delete_habit",
        "get_day",
        "get_habit",
        "list_days",
        "list_habits",
        "record_day",
        "set_day_comment",
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
});
