-- 001_init.sql
-- P2 baseline: sources registry + minimal pages table.
-- Typed columns (status, author, revision_history, content_version),
-- pages_conflicts, chunks, links, tags, and body_tsv all arrive in later migrations.

CREATE TABLE sources (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT UNIQUE NOT NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sync       TIMESTAMPTZ,
  last_sync_host  TEXT,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE pages (
  id           BIGSERIAL PRIMARY KEY,
  source_id    BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  type         TEXT NOT NULL,
  title        TEXT,
  frontmatter  JSONB NOT NULL DEFAULT '{}'::jsonb,
  body         TEXT NOT NULL,
  mtime        TIMESTAMPTZ NOT NULL,
  hash         TEXT NOT NULL,
  is_raw       BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, path),
  UNIQUE (source_id, slug)
);

CREATE INDEX pages_source_type_idx ON pages(source_id, type);
