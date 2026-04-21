import { env } from "cloudflare:test";
import type { Habit } from "../src/db/schema.js";
import { createHabit } from "../src/db/habits.js";
import type { McpContext } from "../src/tools.js";
import type { EmbeddingProvider } from "../src/vector/types.js";
import { fakeEmbeddings, inMemoryStore, type InMemoryStore } from "./vector-stub.js";

export const db = () => env.DB;

export async function makeHabit(
  overrides: Partial<{
    name: string;
    description: string | null;
    startDate: string;
    endDate: string | null;
  }> = {},
): Promise<Habit> {
  return createHabit(db(), {
    name: overrides.name ?? "Meditate",
    description: overrides.description ?? null,
    startDate: overrides.startDate ?? "2026-01-01",
    endDate: overrides.endDate ?? null,
  });
}

export interface TestContext extends McpContext {
  store: InMemoryStore;
  embed: EmbeddingProvider;
}

export function testContext(): TestContext {
  return { db: db(), store: inMemoryStore(), embed: fakeEmbeddings() };
}
