-- 005_pages_conflicts.sql
-- P6 second slice: surface concurrent-edit conflicts as data, never auto-merge
-- (PRD §17 decision 13). One row per detected conflict; the conflict outlives
-- the page row it describes (page_id ON DELETE SET NULL + denormalized
-- page_path snapshot), so `sync --full` doesn't erase forensic evidence.

CREATE TABLE pages_conflicts (
  id                       BIGSERIAL PRIMARY KEY,
  source_id                BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  page_id                  BIGINT REFERENCES pages(id) ON DELETE SET NULL,
  page_path                TEXT NOT NULL,                     -- snapshot — survives page deletion
  detected_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  detecting_host           TEXT NOT NULL,
  base_content_version     BIGINT,                            -- null when cache_loss_fallback couldn't infer one
  current_content_version  BIGINT,                            -- DB version at conflict time (null if we couldn't read)
  loser_body               TEXT NOT NULL,                     -- body that lost the CAS — preserved for human resolution
  loser_frontmatter        JSONB NOT NULL DEFAULT '{}'::jsonb,
  cause                    TEXT NOT NULL DEFAULT 'concurrent_edit',
                                                              -- 'concurrent_edit' | 'cache_loss_fallback' | 'unknown'
  resolved_at              TIMESTAMPTZ,
  resolution_note          TEXT
);

-- Partial index — almost all queries want "open conflicts only" and this
-- stays tiny once conflicts are routinely resolved.
CREATE INDEX pages_conflicts_source_open_idx
  ON pages_conflicts(source_id) WHERE resolved_at IS NULL;
