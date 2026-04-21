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
import { chunkText, CHUNK_MAX_CHARS } from "../src/vector/chunker.js";

type ConnectResult<S> = {
  client: Client;
  store: S;
  close: () => Promise<void>;
};

async function connect(): Promise<ConnectResult<InMemoryStore>>;
async function connect(
  overrides: Partial<McpContext>,
): Promise<ConnectResult<InMemoryStore | null>>;
async function connect(
  overrides: Partial<McpContext> = {},
): Promise<ConnectResult<InMemoryStore | null>> {
  const defaults = testContext();
  const ctx: McpContext = {
    db: overrides.db ?? defaults.db,
    store: overrides.store ?? defaults.store,
    embed: overrides.embed ?? defaults.embed,
  };
  const store: InMemoryStore | null = overrides.store ? null : defaults.store;
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
    store,
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
  chunk_index: number;
  snippet: string;
}

function vectorIdsForSource(store: InMemoryStore, sourceId: string): string[] {
  return [...store.vectors.keys()].filter((k) => k.startsWith(`${sourceId}:`));
}

async function chunkCount(sourceId: string): Promise<number> {
  const row = await db()
    .prepare(`SELECT chunk_count FROM text_chunks WHERE source_id = ?1`)
    .bind(sourceId)
    .first<{ chunk_count: number }>();
  return row?.chunk_count ?? 0;
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

    expect(store.vectors.has(`habit:${habitId}:name:0`)).toBe(true);
    expect(store.vectors.has(`habit:${habitId}:description:0`)).toBe(true);
    expect(await chunkCount(`habit:${habitId}:name`)).toBe(1);
    expect(await chunkCount(`habit:${habitId}:description`)).toBe(1);

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
    expect(store.vectors.has(`habit:${habitId}:description:0`)).toBe(false);
    expect(await chunkCount(`habit:${habitId}:description`)).toBe(0);
  });

  it("removes the description vector when cleared via update", async () => {
    const res = await call<{ habit: { id: number } }>(client, "create_habit", {
      name: "Read",
      description: "daily fiction",
      start_date: "2026-01-01",
    });
    const habitId = res.data.habit.id;
    expect(store.vectors.has(`habit:${habitId}:description:0`)).toBe(true);

    await call(client, "update_habit", { id: habitId, description: null });
    expect(store.vectors.has(`habit:${habitId}:description:0`)).toBe(false);
    expect(await chunkCount(`habit:${habitId}:description`)).toBe(0);
    expect(store.vectors.has(`habit:${habitId}:name:0`)).toBe(true);
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

    expect(store.vectors.has("day:2026-02-01:comment:0")).toBe(true);
    expect(store.vectors.has(`checkin:${habitId}:2026-02-01:note:0`)).toBe(true);

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
    const sourceId = `checkin:${habitId}:2026-03-01:note`;
    const before = store.vectors.get(`${sourceId}:0`)!.values.slice();

    await call(client, "upsert_check_in", {
      habit_id: habitId,
      date: "2026-03-01",
      note: "totally different words now",
    });
    const after = store.vectors.get(`${sourceId}:0`)!.values;
    expect(after).not.toEqual(before);

    await call(client, "delete_check_in", {
      habit_id: habitId,
      date: "2026-03-01",
    });
    expect(store.vectors.has(`${sourceId}:0`)).toBe(false);
    expect(await chunkCount(sourceId)).toBe(0);
  });

  it("purges habit + check-in note chunks when the habit is deleted", async () => {
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

    expect(store.vectors.has(`habit:${habitId}:name:0`)).toBe(false);
    expect(store.vectors.has(`habit:${habitId}:description:0`)).toBe(false);
    expect(store.vectors.has(`checkin:${habitId}:2026-04-01:note:0`)).toBe(false);
    expect(store.vectors.has(`checkin:${habitId}:2026-04-02:note:0`)).toBe(false);
    expect(await chunkCount(`habit:${habitId}:name`)).toBe(0);
    expect(await chunkCount(`habit:${habitId}:description`)).toBe(0);
    expect(await chunkCount(`checkin:${habitId}:2026-04-01:note`)).toBe(0);
    expect(await chunkCount(`checkin:${habitId}:2026-04-02:note`)).toBe(0);
  });

  it("removes the day comment chunks on delete_day_comment", async () => {
    await call(client, "set_day_comment", {
      date: "2026-05-01",
      comment: "note to self",
    });
    expect(store.vectors.has("day:2026-05-01:comment:0")).toBe(true);

    await call(client, "delete_day_comment", { date: "2026-05-01" });
    expect(store.vectors.has("day:2026-05-01:comment:0")).toBe(false);
    expect(await chunkCount("day:2026-05-01:comment")).toBe(0);
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

    expect(store.vectors.has("day:2026-06-10:comment:0")).toBe(true);
    expect(store.vectors.has(`checkin:${habitId}:2026-06-10:note:0`)).toBe(true);
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
    expect(store.vectors.has(`habit:${habitId}:name:0`)).toBe(true);

    await db().prepare("DELETE FROM habits WHERE id = ?1").bind(habitId).run();
    expect(store.vectors.has(`habit:${habitId}:name:0`)).toBe(true);

    const search = await call<{ results: SearchResult[] }>(client, "search_text", {
      query: "piano",
      limit: 10,
    });
    expect(search.isError).toBe(false);
    expect(search.data.results.find((r) => r.habit_id === habitId)).toBeUndefined();
  });
});

describe("chunked long-text sync", () => {
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

  function longComment(): string {
    const para = "First paragraph about morning meditation and breathing exercises that ground me. ";
    const para2 = "Second paragraph about evening journaling and gratitude practices that uplift me. ";
    const para3 = "Third paragraph about midday walks among the trees and listening to gentle wind. ";
    const para4 = "Fourth paragraph about reading physical books in the warm afternoon sunlight. ";
    return [para.repeat(20), para2.repeat(20), para3.repeat(20), para4.repeat(20)].join("\n\n");
  }

  it("splits a long day comment into multiple chunks", async () => {
    const text = longComment();
    expect(text.length).toBeGreaterThan(CHUNK_MAX_CHARS * 2);

    await call(client, "set_day_comment", {
      date: "2026-08-01",
      comment: text,
    });

    const sourceId = "day:2026-08-01:comment";
    const ids = vectorIdsForSource(store, sourceId);
    expect(ids.length).toBeGreaterThan(1);
    expect(await chunkCount(sourceId)).toBe(ids.length);
    expect(ids.length).toBe(chunkText(text).length);
  });

  it("shrinks the chunk set when the comment is shortened", async () => {
    const sourceId = "day:2026-08-02:comment";
    await call(client, "set_day_comment", {
      date: "2026-08-02",
      comment: longComment(),
    });
    const longCount = vectorIdsForSource(store, sourceId).length;
    expect(longCount).toBeGreaterThan(1);
    expect(await chunkCount(sourceId)).toBe(longCount);

    await call(client, "set_day_comment", {
      date: "2026-08-02",
      comment: "short note",
    });
    const shortIds = vectorIdsForSource(store, sourceId);
    expect(shortIds).toEqual([`${sourceId}:0`]);
    expect(await chunkCount(sourceId)).toBe(1);
  });

  it("grows the chunk set when the comment is lengthened", async () => {
    const sourceId = "day:2026-08-03:comment";
    await call(client, "set_day_comment", {
      date: "2026-08-03",
      comment: "short note",
    });
    expect(vectorIdsForSource(store, sourceId)).toEqual([`${sourceId}:0`]);

    await call(client, "set_day_comment", {
      date: "2026-08-03",
      comment: longComment(),
    });
    const ids = vectorIdsForSource(store, sourceId);
    expect(ids.length).toBeGreaterThan(1);
    expect(await chunkCount(sourceId)).toBe(ids.length);
  });

  it("dedupes search results per source and returns the matching chunk as snippet", async () => {
    const text = longComment();
    await call(client, "set_day_comment", {
      date: "2026-08-04",
      comment: text,
    });

    const search = await call<{ results: SearchResult[] }>(client, "search_text", {
      query: "evening journaling gratitude practices",
      limit: 5,
    });
    expect(search.isError).toBe(false);

    const dayHits = search.data.results.filter(
      (r) => r.kind === "day_comment" && r.date === "2026-08-04",
    );
    expect(dayHits.length).toBe(1);

    const allChunks = chunkText(text);
    expect(allChunks).toContain(dayHits[0]!.snippet);
    expect(dayHits[0]!.snippet).toContain("evening");
  });

  it("purges all chunks of a long check-in note on delete", async () => {
    const h = await call<{ habit: { id: number } }>(client, "create_habit", {
      name: "Write",
      start_date: "2026-01-01",
    });
    const habitId = h.data.habit.id;
    const sourceId = `checkin:${habitId}:2026-08-05:note`;

    await call(client, "upsert_check_in", {
      habit_id: habitId,
      date: "2026-08-05",
      note: longComment(),
    });
    expect(vectorIdsForSource(store, sourceId).length).toBeGreaterThan(1);

    await call(client, "delete_check_in", {
      habit_id: habitId,
      date: "2026-08-05",
    });
    expect(vectorIdsForSource(store, sourceId)).toEqual([]);
    expect(await chunkCount(sourceId)).toBe(0);
  });

  it("does not lose chunks across many shrink/grow cycles", async () => {
    const sourceId = "day:2026-08-06:comment";
    const long = longComment();
    const longLen = chunkText(long).length;

    for (let i = 0; i < 4; i++) {
      await call(client, "set_day_comment", { date: "2026-08-06", comment: long });
      expect(vectorIdsForSource(store, sourceId).length).toBe(longLen);
      expect(await chunkCount(sourceId)).toBe(longLen);

      await call(client, "set_day_comment", { date: "2026-08-06", comment: "tiny" });
      expect(vectorIdsForSource(store, sourceId)).toEqual([`${sourceId}:0`]);
      expect(await chunkCount(sourceId)).toBe(1);
    }
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
  it("rebuilds embeddings from existing D1 rows and counts sources + chunks", async () => {
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
      .prepare(`INSERT INTO days (date, comment) VALUES (?1, ?2)`)
      .bind("2026-03-01", "good day")
      .run();
    await db()
      .prepare(`INSERT INTO days (date, comment) VALUES (?1, ?2)`)
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
          total_chunks: number;
          orphans_removed: number;
        };
      }>(client, "reindex_embeddings");
      expect(res.isError).toBe(false);
      expect(res.data.reindexed).toEqual({
        habit_names: 2,
        habit_descriptions: 1,
        day_comments: 1,
        check_in_notes: 1,
        total_chunks: 5,
        orphans_removed: 0,
      });
      expect(store.vectors.size).toBe(5);
    } finally {
      await close();
    }
  });

  it("removes orphan text_chunks + vectors for rows deleted out-of-band", async () => {
    const store = inMemoryStore();
    const embed = fakeEmbeddings();

    const { client, close } = await connect({ store, embed });
    try {
      const h = await call<{ habit: { id: number } }>(client, "create_habit", {
        name: "Keep around",
        description: "will be orphaned",
        start_date: "2026-01-01",
      });
      const habitId = h.data.habit.id;
      await call(client, "set_day_comment", {
        date: "2026-09-10",
        comment: "journaled",
      });
      await call(client, "upsert_check_in", {
        habit_id: habitId,
        date: "2026-09-10",
        note: "did the thing",
      });

      // Bypass sync hooks: delete D1 rows directly so vectors + text_chunks
      // rows remain as orphans.
      await db()
        .prepare("DELETE FROM habits WHERE id = ?1")
        .bind(habitId)
        .run();
      await db()
        .prepare("DELETE FROM days WHERE date = ?1")
        .bind("2026-09-10")
        .run();
      // check_ins cascaded with the habit delete, but its text_chunks row
      // and vectors still linger.

      const orphanSources = [
        `habit:${habitId}:name`,
        `habit:${habitId}:description`,
        "day:2026-09-10:comment",
        `checkin:${habitId}:2026-09-10:note`,
      ];
      for (const s of orphanSources) {
        expect(await chunkCount(s)).toBeGreaterThan(0);
        expect(vectorIdsForSource(store, s).length).toBeGreaterThan(0);
      }

      const res = await call<{
        reindexed: {
          habit_names: number;
          habit_descriptions: number;
          day_comments: number;
          check_in_notes: number;
          total_chunks: number;
          orphans_removed: number;
        };
      }>(client, "reindex_embeddings");
      expect(res.isError).toBe(false);
      expect(res.data.reindexed.orphans_removed).toBe(orphanSources.length);

      for (const s of orphanSources) {
        expect(await chunkCount(s)).toBe(0);
        expect(vectorIdsForSource(store, s)).toEqual([]);
      }
    } finally {
      await close();
    }
  });

  it("cleans up orphaned chunks when reindex sees a shorter text than before", async () => {
    const store = inMemoryStore();
    const embed = fakeEmbeddings();

    const { client, close } = await connect({ store, embed });
    try {
      const long = "Long ".repeat(800);
      await call(client, "set_day_comment", {
        date: "2026-09-01",
        comment: long,
      });
      const sourceId = "day:2026-09-01:comment";
      const longCount = vectorIdsForSource(store, sourceId).length;
      expect(longCount).toBeGreaterThan(1);

      // Mutate D1 directly to a short comment, bypassing the sync hook.
      await db()
        .prepare(`UPDATE days SET comment = ?1 WHERE date = ?2`)
        .bind("now short", "2026-09-01")
        .run();
      // The vector store still has the long-form orphans.
      expect(vectorIdsForSource(store, sourceId).length).toBe(longCount);

      const res = await call<{
        reindexed: { day_comments: number; total_chunks: number };
      }>(client, "reindex_embeddings");
      expect(res.isError).toBe(false);
      expect(vectorIdsForSource(store, sourceId)).toEqual([`${sourceId}:0`]);
      expect(await chunkCount(sourceId)).toBe(1);
    } finally {
      await close();
    }
  });
});
