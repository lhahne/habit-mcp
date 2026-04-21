import type {
  EmbeddingProvider,
  VectorMatch,
  VectorMetadata,
  VectorQuery,
  VectorStore,
  VectorUpsert,
} from "../src/vector/types.js";

const DIM = 32;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function hash(token: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function embedText(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  const tokens = tokenize(text);
  for (const t of tokens) {
    const idx = hash(t) % DIM;
    vec[idx] = (vec[idx] ?? 0) + 1;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

export function fakeEmbeddings(): EmbeddingProvider {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map(embedText);
    },
  };
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

function matchesFilter(
  metadata: VectorMetadata,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (!filter) return true;
  for (const [key, spec] of Object.entries(filter)) {
    const actual = (metadata as Record<string, unknown>)[key];
    if (
      spec &&
      typeof spec === "object" &&
      !Array.isArray(spec) &&
      "$in" in (spec as Record<string, unknown>)
    ) {
      const allowed = (spec as { $in: unknown[] }).$in;
      if (!allowed.includes(actual)) return false;
    } else if (actual !== spec) {
      return false;
    }
  }
  return true;
}

export interface InMemoryStore extends VectorStore {
  readonly vectors: Map<string, VectorUpsert>;
}

export function inMemoryStore(): InMemoryStore {
  const vectors = new Map<string, VectorUpsert>();
  return {
    vectors,
    async upsert(upserts: VectorUpsert[]): Promise<void> {
      for (const v of upserts) vectors.set(v.id, v);
    },
    async deleteByIds(ids: string[]): Promise<void> {
      for (const id of ids) vectors.delete(id);
    },
    async query(vector: number[], opts: VectorQuery): Promise<VectorMatch[]> {
      const scored: VectorMatch[] = [];
      for (const v of vectors.values()) {
        if (!matchesFilter(v.metadata, opts.filter as Record<string, unknown> | undefined)) continue;
        scored.push({
          id: v.id,
          score: cosine(vector, v.values),
          metadata: v.metadata,
        });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, opts.topK);
    },
  };
}

export function failingStore(err: Error = new Error("vector store offline")): VectorStore {
  return {
    async upsert() {
      throw err;
    },
    async deleteByIds() {
      throw err;
    },
    async query() {
      throw err;
    },
  };
}

export function failingEmbeddings(
  err: Error = new Error("embeddings offline"),
): EmbeddingProvider {
  return {
    async embed() {
      throw err;
    },
  };
}
