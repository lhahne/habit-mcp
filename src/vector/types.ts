export const KINDS = [
  "habit_name",
  "habit_description",
  "day_comment",
  "day_exercise",
  "day_weekly_comment",
  "check_in_note",
] as const;

export type Kind = (typeof KINDS)[number];

export interface VectorMetadata {
  kind: Kind;
  habit_id?: number;
  date?: string;
  [key: string]: unknown;
}

export interface VectorMatch {
  id: string;
  score: number;
  metadata: VectorMetadata;
}

export interface VectorUpsert {
  id: string;
  values: number[];
  metadata: VectorMetadata;
}

export interface VectorQuery {
  topK: number;
  filter?: Partial<Record<keyof VectorMetadata, unknown>>;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorStore {
  upsert(vectors: VectorUpsert[]): Promise<void>;
  deleteByIds(ids: string[]): Promise<void>;
  query(vector: number[], opts: VectorQuery): Promise<VectorMatch[]>;
}
