import type {
  EmbeddingProvider,
  VectorMatch,
  VectorMetadata,
  VectorQuery,
  VectorStore,
  VectorUpsert,
} from "./types.js";

export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const EMBEDDING_DIMENSIONS = 1024;

interface EmbeddingResponse {
  shape: number[];
  data: number[][];
}

export function workersAIEmbeddings(ai: Ai): EmbeddingProvider {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const res = (await ai.run(EMBEDDING_MODEL, {
        text: texts,
      })) as unknown as EmbeddingResponse;
      return res.data;
    },
  };
}

export function vectorizeStore(index: Vectorize): VectorStore {
  return {
    async upsert(vectors: VectorUpsert[]): Promise<void> {
      if (vectors.length === 0) return;
      await index.upsert(
        vectors.map((v) => ({
          id: v.id,
          values: v.values,
          metadata: v.metadata as unknown as Record<string, VectorizeVectorMetadata>,
        })),
      );
    },

    async deleteByIds(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      await index.deleteByIds(ids);
    },

    async query(vector: number[], opts: VectorQuery): Promise<VectorMatch[]> {
      const res = await index.query(vector, {
        topK: opts.topK,
        returnMetadata: "all",
        ...(opts.filter
          ? { filter: opts.filter as unknown as VectorizeVectorMetadataFilter }
          : {}),
      });
      return (res.matches ?? []).map((m) => ({
        id: m.id,
        score: m.score,
        metadata: (m.metadata ?? {}) as unknown as VectorMetadata,
      }));
    },
  };
}
