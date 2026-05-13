-- 007_chunks.sql
-- P9a: embedding infrastructure. One chunk per H2 section of a page body.
-- Embedding is nullable so sync can succeed even when the embedding API is
-- unavailable (graceful degrade per PRD spirit) — those chunks are searchable
-- by keyword via the page's body_tsv but won't show up in vector retrieval
-- until a future sync embeds them.
--
-- embedding_model is recorded so a future config change (3-small → 3-large
-- → different dimension count) can detect mixed-dimension chunks and trigger
-- a rebuild.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE chunks (
  id              BIGSERIAL PRIMARY KEY,
  source_id       BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  page_id         BIGINT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  heading         TEXT,
  ordinal         INT NOT NULL,
  content         TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  embedding       vector(1536),
  embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_id, ordinal)
);

CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX chunks_source_idx ON chunks(source_id);
CREATE INDEX chunks_page_idx ON chunks(page_id);
