-- 002_links.sql
-- P4: link graph. One row per occurrence (PRD §6.3).
-- kind='wikilink': derived from [[…]] in page body.
-- kind='related':  derived from frontmatter `related: [[X]]` arrays.
-- to_page is NULL when the target slug has no matching page in the source —
-- those rows are what `memex doctor` reports as broken wikilinks.

CREATE TABLE links (
  id           BIGSERIAL PRIMARY KEY,
  source_id    BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  from_page    BIGINT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  to_slug      TEXT NOT NULL,
  to_page      BIGINT REFERENCES pages(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL DEFAULT 'wikilink',
  resolved     BOOLEAN GENERATED ALWAYS AS (to_page IS NOT NULL) STORED
);

CREATE INDEX links_source_idx       ON links(source_id);
CREATE INDEX links_from_idx         ON links(from_page);
CREATE INDEX links_to_idx           ON links(to_page);
CREATE INDEX links_source_kind_idx  ON links(source_id, kind);
