import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { buildMcpServer, type McpContext } from "../src/tools.js";
import { db, testContext } from "./helpers.js";
import {
  failingEmbeddings,
  failingStore,
  inMemoryStore,
  fakeEmbeddings,
  type InMemoryStore,
} from "./vector-stub.js";

async function connect(ctxOverrides: Partial<McpContext> = {}): Promise<{
  client: Client;
  store: InMemoryStore;
  close: () => Promise<void>;
}> {
  const ctx = testContext(ctxOverrides);
  const server = buildMcpServer(ctx);
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
    store: ctx.store as InMemoryStore,
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
  return {
    raw,
    isError: raw.isError === true,
    data: (raw.structuredContent as T) ?? (undefined as T),
  };
}

interface SearchResult {
  id: string;
  kind: string;
  score: number;
  habit_id?: number;
  date?: string;
  snippet: string;
}

describe("search_text", () => {
  let client: Client;
  let store: InMemoryStore;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const conn = await connect();
    client = conn.client;
    store = conn.store;
    close = conn.close;
  });

  afterEach(async () => {
    await close();
  });

  it("indexes habit name + description on create and finds them", async () => {
    const res = await call<{ habit: { id: number } }>(client, "create_habit", {
      name: "Morning meditation",
      description: "sit quiet breathe focus",
      start_date: "2026-01-01",
    });
    expect(res.isError).toBe(false);
    const habitId = res.data.habit.id;

    expect(store.vectors.has(`habit:${habitId}:name`)).toBe(true);
    expect(store.vectors.has(`habit:${habitId}:description`)).toBe(true);

    const search = await call<{ results: SearchResult[] }>(client, "search_text", {
      query: "morning meditation",
      limit: 5,
    });
    expect(search.isError).toBe(false);
    const kinds = search.data.results.map((r) => r.kind);
    expect(kinds).toContain("habit_name");
  });

  it("does not index an empty description", async () => {
    const res = await call<{ habit: { id: number } }>(client, "create_habit", {
      name: "Walk",
      start_date: "2026-01-01",
    });
    const habitId = res.data.habit.id;
    expect(store.vectors.has(`habit:${habitId}:description`)).toBe(false);
  });

  it("removes the description vector when cleared via update", async () => {
    const res = await call<{ habit: { id: number } }>(client, "create_habit", {
      name: "Read",
      description: "daily fiction",
      start_date: "2026-01-01",
    });
    const habitId = res.data.habit.id;
    expect(store.vectors.has(`habit:${habitId}:description`)).toBe(true);

    await call(client, "update_habit", { id: habitId, description: null });
    expect(store.vectors.has(`habit:${habitId}:description`)).toBe(false);
    expect(store.vectors.has(`habit:${habitId}:name`)).toBe(true);
  });

  it("indexes day comments and check-in notes, kind filter narrows results", async () => {
    const h = await call<{ habit: { id: number } }>(client, "create_habit", {
      name: "Journal",
      start_date: "2026-01-01",
    });
    const habitId = h.data.habit.id;

    await call(client, "set_day_comment", {
      date: "2026-02-01",
      comment: "felt very tired struggled",
    });
    await call(client, "upsert_check_in", {
      habit_id: habitId,
      date: "2026-02-01",
      note: "wrote a page about dreams",
    });

    expect(store.vectors.has("day:2026-02-01:comment")).toBe(true);
    expect(store.vectors.has(`checkin:${habitId}:2026-02-01:note`)).toBe(true);

    const all = await call<{ results: SearchResult[] }>(client, "search_text", {
      query: "dreams",
      limit: 10,
    });
    expect(all.isError).toBe(false);
    expect(all.data.results.some((r) => r.kind === "check_in_note")).toBe(true);

    const onlyDay = await call<{ results: SearchResult[] }>(client, "search_text", {
      query: "tired struggled",
      limit: 10,
      kinds: ["day_comment"],
    });
    expect(onlyDay.data.results.every((r) => r.kind === "day_comment")).toBe(true);
  });

  it("updates a check-in note vector on upsert and removes it on delete", async () => {
    const h = await call<{ habit: { id: number } }>(client, "create_habit", {
      name: "Run",
      start_date: "2026-01-01",
    });
    const habitId = h.data.habit.id;

    await call(client, "upsert_check_in", {
      habit_id: habitId,
      date: "2026-03-01",
      note: "original note",
    });
    const key = `checkin:${habitId}:2026-03-01:note`;
    const before = store.vectors.get(key)!.values.slice();

    await call(client, "upsert_check_in", {
      habit_id: habitId,
      date: "2026-03-01",
      note: "totally different words now",
    });
    const after = store.vectors.get(key)!.values;
    expect(after).not.toEqual(before);

    await call(client, "delete_check_in", {
      habit_id: habitId,
      date: "2026-03-01",
    });
    expect(store.vectors.has(key)).toBe(false);
  });

  it("purges habit + check-in note vectors when the habit is deleted", async () => {
    const h = await call<{ habit: { id: number } }>(client, "create_habit", {
      name: "Swim",
      description: "freestyle laps",
      start_date: "2026-01-01",
    });
    const habitId = h.data.habit.id;
    await call(client, "upsert_check_in", {
      habit_id: habitId,
      date: "2026-04-01",
      note: "morning session",
    });
    await call(client, "upsert_check_in", {
      habit_id: habitId,
      date: "2026-04-02",
      note: "evening session",
    });

    expect(store.vectors.size).toBeGreaterThanOrEqual(4);

    await call(client, "delete_habit", { id: habitId });

    expect(store.vectors.has(`habit:${habitId}:name`)).toBe(false);
    expect(store.vectors.has(`habit:${habitId}:description`)).toBe(false);
    expect(store.vectors.has(`checkin:${habitId}:2026-04-01:note`)).toBe(false);
    expect(store.vectors.has(`checkin:${habitId}:2026-04-02:note`)).toBe(false);
  });

  it("removes the day comment vector on delete_day_comment", async () => {
    await call(client, "set_day_comment", {
      date: "2026-05-01",
      comment: "note to self",
    });
    expect(store.vectors.has("day:2026-05-01:comment")).toBe(true);

    await call(client, "delete_day_comment", { date: "2026-05-01" });
    expect(store.vectors.has("day:2026-05-01:comment")).toBe(false);
  });

  it("record_day syncs comment and check-in notes", async () => {
    const h = await call<{ habit: { id: number } }>(client, "create_habit", {
      name: "Stretch",
      start_date: "2026-01-01",
    });
    const habitId = h.data.habit.id;

    await call(client, "record_day", {
      date: "2026-06-10",
      comment: "whole day recap",
      check_ins: [{ habit_id: habitId, done: true, note: "ten minutes" }],
    });

    expect(store.vectors.has("day:2026-06-10:comment")).toBe(true);
    expect(store.vectors.has(`checkin:${habitId}:2026-06-10:note`)).toBe(true);
  });

  it("hydrates search results with habit / day / check_in objects", async () => {
    const h = await call<{ habit: { id: number; name: string } }>(
      client,
      "create_habit",
      {
        name: "Hydrate",
        description: "drink plenty of water",
        start_date: "2026-01-01",
      },
    );
    const habitId = h.data.habit.id;
    await call(client, "set_day_comment", {
      date: "2026-07-01",
      comment: "great water intake today",
    });
    await call(client, "upsert_check_in", {
      habit_id: habitId,
      date: "2026-07-01",
      note: "eight glasses water",
    });

    const search = await call<{
      results: (SearchResult & {
        habit?: { id: number };
        day?: { comment: string };
        check_in?: { note: string | null };
      })[];
    }>(client, "search_text", { query: "water glasses", limit: 10 });

    expect(search.isError).toBe(false);
    const byKind = new Map(search.data.results.map((r) => [r.kind, r]));
    expect(byKind.get("habit_description")?.habit?.id).toBe(habitId);
    expect(byKind.get("day_comment")?.day?.comment).toBe("great water intake today");
    expect(byKind.get("check_in_note")?.check_in?.note).toBe("eight glasses water");
  });

  it("skips stale vectors whose rows no longer exist in D1", async () => {
    const h = await call<{ habit: { id: number } }>(client, "create_habit", {
      name: "Piano",
      start_date: "2026-01-01",
    });
    const habitId = h.data.habit.id;
    expect(store.vectors.has(`habit:${habitId}:name`)).toBe(true);

    await db().prepare("DELETE FROM habits WHERE id = ?1").bind(habitId).run();
    expect(store.vectors.has(`habit:${habitId}:name`)).toBe(true);

    const search = await call<{ results: SearchResult[] }>(client, "search_text", {
      query: "piano",
      limit: 10,
    });
    expect(search.isError).toBe(false);
    expect(search.data.results.find((r) => r.habit_id === habitId)).toBeUndefined();
  });
});

describe("best-effort sync", () => {
  it("create_habit still succeeds when the vector store fails", async () => {
    const { client, close } = await connect({ store: failingStore() });
    try {
      const res = await call<{ habit: { id: number } }>(client, "create_habit", {
        name: "Ok even if vectors break",
        start_date: "2026-01-01",
      });
      expect(res.isError).toBe(false);
      expect(res.data.habit.id).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("create_habit still succeeds when embeddings fail", async () => {
    const { client, close } = await connect({ embed: failingEmbeddings() });
    try {
      const res = await call<{ habit: { id: number } }>(client, "create_habit", {
        name: "Also ok",
        start_date: "2026-01-01",
      });
      expect(res.isError).toBe(false);
    } finally {
      await close();
    }
  });

  it("search_text surfaces embedding failures as isError", async () => {
    const { client, close } = await connect({ embed: failingEmbeddings() });
    try {
      const res = await call(client, "search_text", { query: "anything" });
      expect(res.isError).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("reindex_embeddings", () => {
  it("rebuilds embeddings from existing D1 rows", async () => {
    const store = inMemoryStore();
    const embed = fakeEmbeddings();

    const h1 = await db()
      .prepare(
        `INSERT INTO habits (name, description, start_date) VALUES (?1, ?2, ?3) RETURNING id`,
      )
      .bind("Yoga", "morning flow", "2026-01-01")
      .first<{ id: number }>();
    const h2 = await db()
      .prepare(
        `INSERT INTO habits (name, description, start_date) VALUES (?1, ?2, ?3) RETURNING id`,
      )
      .bind("Write", null, "2026-01-01")
      .first<{ id: number }>();
    await db()
      .prepare(
        `INSERT INTO days (date, comment) VALUES (?1, ?2)`,
      )
      .bind("2026-03-01", "good day")
      .run();
    await db()
      .prepare(
        `INSERT INTO days (date, comment) VALUES (?1, ?2)`,
      )
      .bind("2026-03-02", "")
      .run();
    await db()
      .prepare(
        `INSERT INTO check_ins (habit_id, date, done, note) VALUES (?1, ?2, 1, ?3)`,
      )
      .bind(h1!.id, "2026-03-01", "did 30 min")
      .run();
    await db()
      .prepare(
        `INSERT INTO check_ins (habit_id, date, done, note) VALUES (?1, ?2, 1, NULL)`,
      )
      .bind(h2!.id, "2026-03-01")
      .run();

    expect(store.vectors.size).toBe(0);

    const { client, close } = await connect({ store, embed });
    try {
      const res = await call<{
        reindexed: {
          habit_names: number;
          habit_descriptions: number;
          day_comments: number;
          check_in_notes: number;
        };
      }>(client, "reindex_embeddings");
      expect(res.isError).toBe(false);
      expect(res.data.reindexed).toEqual({
        habit_names: 2,
        habit_descriptions: 1,
        day_comments: 1,
        check_in_notes: 1,
      });
      expect(store.vectors.size).toBe(5);
    } finally {
      await close();
    }
  });
});
