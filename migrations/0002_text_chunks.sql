CREATE TABLE text_chunks (
  source_id   TEXT    PRIMARY KEY,
  chunk_count INTEGER NOT NULL,
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
