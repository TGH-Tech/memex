-- 003_pages_tsv.sql
-- P5: keyword search. `body_tsv` is a generated column — Postgres maintains it
-- automatically on every INSERT/UPDATE of `title` or `body`, so sync code stays
-- unchanged. GIN index gives sub-millisecond `body_tsv @@ tsquery` lookups.

ALTER TABLE pages
  ADD COLUMN body_tsv tsvector
    GENERATED ALWAYS AS (
      to_tsvector('english', coalesce(title, '') || ' ' || body)
    ) STORED;

CREATE INDEX pages_body_tsv_idx ON pages USING GIN (body_tsv);
