-- 004_typed_columns.sql
-- P6 (first slice): promote load-bearing frontmatter keys to typed columns
-- so the index, citation-fixer, and supersession-DAG queries can use SQL
-- predicates instead of JSONB extractors.
--
-- After sync re-runs, frontmatter JSONB will carry ONLY keys NOT in this list —
-- typed columns win; no two-source-of-truth drift (PRD §17 decision 19).
--
-- `content_version` is added now as the foundation for P6 second-slice CAS,
-- but no CAS logic uses it yet — every upsert just resets it via DEFAULT 1.

ALTER TABLE pages
  ADD COLUMN status               TEXT      NOT NULL DEFAULT 'active',
  ADD COLUMN author               TEXT,
  ADD COLUMN co_authors           JSONB     NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN date                 DATE,
  ADD COLUMN supersedes_slug      TEXT,
  ADD COLUMN superseded_by_slug   TEXT,
  ADD COLUMN revision_history     JSONB     NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN content_version      BIGINT    NOT NULL DEFAULT 1;

CREATE INDEX pages_source_status_idx on pages(source_id, status);
CREATE INDEX pages_source_author_idx on pages(source_id, author);

-- Invalidate existing hashes so the next `memex sync` reparses every page and
-- backfills the typed columns from frontmatter. Without this, hash-skip (added
-- in this same release) would leave existing rows with default values forever.
UPDATE pages SET hash = '__migration_004_invalidated__';
