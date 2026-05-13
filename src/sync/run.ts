import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { loadConfig } from '../db/config.ts';
import type { DbClient } from '../db/client.ts';
import { getMount } from '../db/mounts.ts';
import {
  clearBasedOn,
  getBasedOn,
  loadSyncState,
  saveSyncState,
  setBasedOn,
  type SyncStateFile,
} from '../db/sync-state.ts';
import { embedBatch, MAX_CHUNK_CHARS } from '../embed/openai.ts';
import { hashContent, parseRaw, type ParsedPage } from '../parser/markdown.ts';
import { extractRelated, extractWikilinks } from '../parser/wikilinks.ts';
import { chunkPage, type Chunk } from './chunks.ts';
import { walkVault } from './walk.ts';

export interface SyncResult {
  source: string;
  pagesFound: number;
  inserted: number;
  updated: number;
  skipped: number;
  deleted: number;
  conflictsConcurrent: number;
  conflictsCacheLoss: number;
  symmetryUpdates: number;
  failed: string[];
  typeBreakdown: Record<string, number>;
  /** Total link rows in DB for this source after sync. */
  linksTotal: number;
  /** Wikilink rows newly inserted this sync (delta). */
  linksWikilinkInserted: number;
  /** Related rows newly inserted this sync (delta). */
  linksRelatedInserted: number;
  /** Wikilinks pointing at slugs that don't resolve (broken). */
  linksUnresolved: number;
  /** Total chunk rows considered this sync (reparsed pages × chunks-per-page). */
  chunksTotal: number;
  /** Chunks newly embedded this sync (delta — hash-skip avoids the rest). */
  chunksReembedded: number;
  /** Chunks reused from existing rows because content_hash matched. */
  chunksSkipped: number;
  /** Chunks indexed but not embedded (oversized, API error, or no API key). */
  chunksFailed: number;
  durationMs: number;
}

interface LinkRow {
  source_id: number;
  from_page: number;
  to_slug: string;
  kind: 'wikilink' | 'related';
}

interface DbPageRow {
  id: number;
  hash: string;
  /**
   * content_version. BIGINT in the schema, cast to int4 on read so postgres-js
   * gives us a real JS number instead of a string. 2^31 versions per page is
   * 68 years of one-update-per-second; we'll never exceed it.
   */
  content_version: number;
}

const PARSE_BATCH = 16;
const LINK_INSERT_BATCH = 1000;

export interface SyncOptions {
  /** Skip the hash-skip optimization — every file gets reparsed and re-upserted. */
  full?: boolean;
}

export async function syncSource(
  sql: DbClient,
  sourceName: string,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const start = Date.now();
  const host = hostname();

  const sourceRows = await sql<{ id: number }[]>`
    SELECT id FROM sources WHERE name = ${sourceName}
  `;
  const sourceRow = sourceRows[0];
  if (!sourceRow) {
    throw new Error(
      `Source "${sourceName}" not registered. Run \`memex sources add ${sourceName} --path <dir>\` first.`,
    );
  }
  const sourceId = sourceRow.id;

  const mountPath = await getMount(sourceName);
  if (!mountPath) {
    throw new Error(
      `No local mount for "${sourceName}" on this host. Re-register with \`memex sources add\`.`,
    );
  }

  const files = await walkVault(mountPath);

  // Snapshot of DB rows. content_version cast to int4 so we work with numbers
  // throughout instead of BIGINT-as-string. Drives hash-skip + CAS base check.
  const dbState = new Map<string, DbPageRow>();
  const dbRows = await sql<{ path: string; id: number; hash: string; content_version: number }[]>`
    SELECT path, id, hash, content_version::int AS content_version
      FROM pages WHERE source_id = ${sourceId}
  `;
  for (const r of dbRows) {
    dbState.set(r.path, { id: r.id, hash: r.hash, content_version: r.content_version });
  }

  const syncState = await loadSyncState();

  const counts = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    conflictsConcurrent: 0,
    conflictsCacheLoss: 0,
  };
  const failed: string[] = [];
  const typeBreakdown: Record<string, number> = {};

  // Track which page ids were reparsed this run. The link-rebuild step uses
  // this to scope its DELETE/INSERT to just these pages — saves a SELECT of
  // skipped pages' bodies (PRD §12's "delete-and-reinsert" optimization).
  const reparsedPageIds = new Set<number>();
  const reparsedParticipants = new Map<
    string,
    { fromId: number; body: string; frontmatter: Record<string, unknown> }
  >();

  for (let i = 0; i < files.length; i += PARSE_BATCH) {
    const batch = files.slice(i, i + PARSE_BATCH);
    const reads = await Promise.allSettled(
      batch.map(async (f) => {
        const raw = await readFile(f.absPath, 'utf8');
        return { file: f, raw, hash: hashContent(raw) };
      }),
    );

    for (let j = 0; j < reads.length; j++) {
      const r = reads[j]!;
      const f = batch[j]!;
      if (r.status === 'rejected') {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.error(`  ✘ Failed to read ${f.relPath}: ${reason}`);
        failed.push(f.relPath);
        continue;
      }

      const { raw, hash } = r.value;
      const dbRow = dbState.get(f.relPath);

      // Case A: new page (not in DB). Plain INSERT.
      if (!dbRow) {
        let page: ParsedPage;
        try {
          page = parseRaw(raw, hash, f.relPath, f.mtime);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.error(`  ✘ Failed to parse ${f.relPath}: ${reason}`);
          failed.push(f.relPath);
          continue;
        }
        typeBreakdown[page.type] = (typeBreakdown[page.type] ?? 0) + 1;
        const inserted = await insertPage(sql, sourceId, page);
        setBasedOn(syncState, sourceName, page.path, {
          version: inserted.content_version,
          hash: page.hash,
        });
        reparsedPageIds.add(inserted.id);
        reparsedParticipants.set(page.path, {
          fromId: inserted.id,
          body: page.body,
          frontmatter: page.frontmatter,
        });
        counts.inserted++;
        continue;
      }

      // Case B: body matches DB. No write needed; keep cache aligned with current DB version.
      if (!opts.full && hash === dbRow.hash) {
        setBasedOn(syncState, sourceName, f.relPath, {
          version: dbRow.content_version,
          hash,
        });
        counts.skipped++;
        continue;
      }

      // Case C: body differs from DB → parse, then decide via CAS.
      let page: ParsedPage;
      try {
        page = parseRaw(raw, hash, f.relPath, f.mtime);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`  ✘ Failed to parse ${f.relPath}: ${reason}`);
        failed.push(f.relPath);
        continue;
      }
      typeBreakdown[page.type] = (typeBreakdown[page.type] ?? 0) + 1;

      const outcome = await applyCAS(sql, sourceId, sourceName, host, page, dbRow, syncState, opts);
      if (outcome.kind === 'updated') {
        counts.updated++;
        reparsedPageIds.add(dbRow.id);
        reparsedParticipants.set(page.path, {
          fromId: dbRow.id,
          body: page.body,
          frontmatter: page.frontmatter,
        });
      } else if (outcome.kind === 'conflict_concurrent') {
        counts.conflictsConcurrent++;
        // DB retains its prior body; that page's existing link rows still reflect the
        // winning content, so we leave them alone (no entry in reparsedParticipants).
      } else if (outcome.kind === 'conflict_cache_loss') {
        counts.conflictsCacheLoss++;
      }
    }
  }

  // Stale-row removal — anything in DB but not on disk gets deleted.
  const livePaths = new Set<string>(files.map((f) => f.relPath));
  const stalePaths = [...dbState.keys()].filter((p) => !livePaths.has(p));
  let deleted = 0;
  if (stalePaths.length > 0) {
    await sql`
      DELETE FROM pages
       WHERE source_id = ${sourceId}
         AND path = ANY(${stalePaths})
    `;
    deleted = stalePaths.length;
    for (const p of stalePaths) clearBasedOn(syncState, sourceName, p);
  }

  // Link rebuild runs BEFORE chunks/embeds. Order matters: the embed call can
  // take 100+ seconds on a first sync, and if the user Ctrl-Cs during it,
  // pages stay committed but anything after this point gets dropped. Pages-
  // committed-but-links-missing is the worst state because hash-skip will then
  // mark the page "unchanged" on every subsequent sync, never rebuilding
  // links until `--full` is invoked. Links-committed-but-chunks-missing is
  // benign: the next sync hits the chunk-rebuild path for those pages anyway.
  //
  // Scoped link rebuild. For pages we reparsed: delete their existing outbound
  // edges and insert fresh ones. For pages we skipped: leave their edges alone
  // (body unchanged → wikilinks unchanged). The resolution UPDATE then runs
  // across ALL still-unresolved edges in this source — that catches sibling
  // renames (cascade NULL'd to_page) and new-page creations (lets stale text
  // suddenly resolve to a newly-matching slug).
  const linkRows: LinkRow[] = [];
  let linksWikilinkInserted = 0;
  let linksRelatedInserted = 0;
  for (const [, content] of reparsedParticipants) {
    const fromId = content.fromId;
    for (const slug of extractWikilinks(content.body)) {
      linkRows.push({ source_id: sourceId, from_page: fromId, to_slug: slug, kind: 'wikilink' });
      linksWikilinkInserted++;
    }
    for (const slug of extractRelated(content.frontmatter)) {
      linkRows.push({ source_id: sourceId, from_page: fromId, to_slug: slug, kind: 'related' });
      linksRelatedInserted++;
    }
  }

  if (reparsedPageIds.size > 0) {
    const reparsedArr = [...reparsedPageIds];
    await sql`DELETE FROM links WHERE source_id = ${sourceId} AND from_page = ANY(${reparsedArr})`;
  }
  for (let i = 0; i < linkRows.length; i += LINK_INSERT_BATCH) {
    const batch = linkRows.slice(i, i + LINK_INSERT_BATCH);
    await sql`INSERT INTO links ${sql(batch, 'source_id', 'from_page', 'to_slug', 'kind')}`;
  }

  // Chunk + embed every reparsed page. Skipped pages keep their existing chunks
  // (body unchanged → chunks unchanged → embeddings unchanged). Runs AFTER
  // link rebuild so an interrupt during the embed call leaves links intact.
  const chunkResult = await syncChunks(sql, sourceId, reparsedParticipants);

  // Re-resolve any unresolved edges (catches sibling-delete cascades that
  // SET NULL'd to_page, and new pages whose slug now matches a stale to_slug).
  await sql`
    UPDATE links l
       SET to_page = p.id
      FROM pages p
     WHERE l.source_id = ${sourceId}
       AND l.to_page IS NULL
       AND p.source_id = l.source_id
       AND p.slug = l.to_slug
  `;
  const unresolvedRow = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM links
     WHERE source_id = ${sourceId}
       AND kind = 'wikilink'
       AND to_page IS NULL
  `;
  const linksUnresolved = unresolvedRow[0]?.count ?? 0;

  // Total active link count for this source (for the sync report). Distinct
  // from the per-sync delta counters above.
  const totalLinksRow = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM links WHERE source_id = ${sourceId}
  `;
  const linksTotal = totalLinksRow[0]?.count ?? 0;

  // Supersession symmetry (PRD §17 decision 14). No content_version bump —
  // derived field; bumping would cause spurious conflicts from another host.
  const symRows = await sql<{ touched: number }[]>`
    WITH inverse AS (
      SELECT DISTINCT ON (target.id)
             target.id AS target_id, src.slug AS src_slug
        FROM pages src
        JOIN pages target
          ON target.source_id = src.source_id
         AND target.slug = src.supersedes_slug
       WHERE src.source_id = ${sourceId}
         AND src.supersedes_slug IS NOT NULL
       ORDER BY target.id, src.slug
    )
    UPDATE pages p
       SET superseded_by_slug = inverse.src_slug,
           updated_at = now()
      FROM inverse
     WHERE p.id = inverse.target_id
       AND (p.superseded_by_slug IS DISTINCT FROM inverse.src_slug)
    RETURNING 1 AS touched
  `;
  const symmetryUpdates = symRows.length;

  await sql`
    UPDATE sources
       SET last_sync = now(),
           last_sync_host = ${host}
     WHERE id = ${sourceId}
  `;

  try {
    await saveSyncState(syncState);
  } catch (err) {
    console.error(
      `  ⚠ Failed to save ~/.memex/cache/sync-state.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Accounting invariant: every walked file must end up in exactly one bucket.
  // If this fires, a code path returned an outcome we didn't count — surface
  // it loudly so we don't paper over real drift.
  const accounted =
    counts.inserted +
    counts.updated +
    counts.skipped +
    counts.conflictsConcurrent +
    counts.conflictsCacheLoss +
    failed.length;
  if (accounted !== files.length) {
    console.warn(
      `  ⚠ Sync accounting drift: ${files.length} files found but ${accounted} accounted ` +
        `(inserted=${counts.inserted}, updated=${counts.updated}, skipped=${counts.skipped}, ` +
        `concurrent=${counts.conflictsConcurrent}, cacheLoss=${counts.conflictsCacheLoss}, ` +
        `failed=${failed.length}). This is a bug — please report.`,
    );
  }

  return {
    source: sourceName,
    pagesFound: files.length,
    inserted: counts.inserted,
    updated: counts.updated,
    skipped: counts.skipped,
    deleted,
    failed,
    typeBreakdown,
    conflictsConcurrent: counts.conflictsConcurrent,
    conflictsCacheLoss: counts.conflictsCacheLoss,
    symmetryUpdates,
    linksTotal,
    linksWikilinkInserted,
    linksRelatedInserted,
    linksUnresolved,
    chunksTotal: chunkResult.total,
    chunksReembedded: chunkResult.reembedded,
    chunksSkipped: chunkResult.skipped,
    chunksFailed: chunkResult.failed,
    durationMs: Date.now() - start,
  };
}

interface ChunkSyncResult {
  total: number;
  reembedded: number;
  skipped: number;
  failed: number;
}

/**
 * For every reparsed page: split its body into chunks, hash each one, skip
 * unchanged chunks, batch-embed the rest in ONE OpenAI call, and UPSERT.
 *
 * Failure modes (per the P9a plan's "graceful degrade" decision):
 *   - OPENAI_API_KEY missing → chunks indexed without embeddings; logged
 *   - Embedding API 5xx → one retry inside embedBatch; on final failure all
 *     chunks in this batch get `failed` status; logged
 *   - Single chunk > MAX_CHUNK_CHARS → filtered before the API call; counted
 *     as failed; logged
 *
 * Cascade: pages stale-deleted earlier already cascaded their chunks via
 * the FK ON DELETE CASCADE, so nothing to clean up here for those.
 */
async function syncChunks(
  sql: DbClient,
  sourceId: number,
  reparsedParticipants: Map<string, { fromId: number; body: string; frontmatter: Record<string, unknown> }>,
): Promise<ChunkSyncResult> {
  if (reparsedParticipants.size === 0) {
    return { total: 0, reembedded: 0, skipped: 0, failed: 0 };
  }

  // 1. Compute new chunks per reparsed page.
  const chunksByPage = new Map<number, Chunk[]>();
  for (const [, content] of reparsedParticipants) {
    chunksByPage.set(content.fromId, chunkPage(content.body));
  }

  const pageIds = [...chunksByPage.keys()];

  // 2. Load existing chunks so we can hash-skip unchanged ones.
  const existing = await sql<{ page_id: number; ordinal: number; content_hash: string }[]>`
    SELECT page_id, ordinal, content_hash
      FROM chunks
     WHERE page_id = ANY(${pageIds})
  `;
  const existingHash = new Map<string, string>();
  for (const e of existing) existingHash.set(`${e.page_id}:${e.ordinal}`, e.content_hash);

  // 3. Walk the new chunks: decide which need embedding, which are reused.
  interface Pending {
    pageId: number;
    chunk: Chunk;
    needsEmbed: boolean;
    embedIndex?: number;
    oversize?: boolean;
  }
  const allPending: Pending[] = [];
  const toEmbedTexts: string[] = [];
  let skipped = 0;
  let oversize = 0;

  for (const [pageId, chunks] of chunksByPage) {
    for (const chunk of chunks) {
      const prevHash = existingHash.get(`${pageId}:${chunk.ordinal}`);
      const unchanged = prevHash === chunk.contentHash;
      const p: Pending = { pageId, chunk, needsEmbed: !unchanged };
      allPending.push(p);
      if (unchanged) {
        skipped++;
        continue;
      }
      if (chunk.content.length > MAX_CHUNK_CHARS) {
        p.oversize = true;
        oversize++;
        continue;
      }
      p.embedIndex = toEmbedTexts.length;
      toEmbedTexts.push(chunk.content);
    }
  }

  if (oversize > 0) {
    console.error(
      `  ⚠ ${oversize} chunk(s) exceed ${MAX_CHUNK_CHARS} chars and will be indexed without embeddings`,
    );
  }

  // 4. Single batched embed call.
  let vectors: Array<number[] | null> = toEmbedTexts.map(() => null);
  let modelName: string | null = null;
  let embedFailed = 0;
  // Tracks whether the embed API call itself failed (transient: 5xx, timeout,
  // network). When true, we skip UPSERTing chunks that depended on this call —
  // leaving their pre-existing row (or absence) intact so next sync retries.
  // Without this, we'd stamp the new content_hash with a NULL embedding and
  // the hash-skip in step 3 would lock the chunk out of re-embedding forever.
  let apiFailed = false;
  if (toEmbedTexts.length > 0) {
    const result = await embedBatch(toEmbedTexts);
    if (result.kind === 'ok') {
      vectors = result.vectors;
      modelName = result.model;
    } else {
      console.error(
        `  ⚠ Embedding failed: ${result.message} — affected chunks left as-is, next sync will retry`,
      );
      embedFailed = toEmbedTexts.length;
      apiFailed = true;
    }
  }

  // 5. Resolve the effective embedding model name for UPSERT. If we got a
  // result from the API, use what OpenAI echoed back; otherwise fall back to
  // the configured model (the column has a NOT NULL constraint).
  if (modelName === null) {
    const config = await loadConfig();
    modelName = config.embedModel;
  }

  // 6 + 7 run inside a transaction so a crash mid-write can't leave a page
  // with the obsolete-ordinal DELETE applied but the new-ordinal UPSERT
  // missing. The HTTP call to OpenAI (step 4) is deliberately outside the
  // tx — holding a DB connection through a 100s embed call is worse than
  // the small consistency risk we just closed.
  let reembedded = 0;
  await sql.begin(async (tx) => {
    // 6. Delete obsolete chunks per page (ordinals that no longer exist).
    for (const [pageId, chunks] of chunksByPage) {
      if (chunks.length === 0) {
        await tx`DELETE FROM chunks WHERE page_id = ${pageId}`;
      } else {
        const validOrdinals = chunks.map((c) => c.ordinal);
        await tx`
          DELETE FROM chunks
           WHERE page_id = ${pageId}
             AND ordinal <> ALL(${validOrdinals})
        `;
      }
    }

    // 7. UPSERT each chunk that needs work. Unchanged chunks (hash match)
    // are no-op — the row already has the right content + embedding. When
    // the embed API failed transiently (apiFailed), skip UPSERTing the
    // chunks that depended on that call so next sync retries them.
    for (const p of allPending) {
      if (!p.needsEmbed) continue;
      const wasEmbedCandidate = p.embedIndex !== undefined;
      if (apiFailed && wasEmbedCandidate) continue;

      let embeddingLiteral: string | null = null;
      if (wasEmbedCandidate) {
        const vec = vectors[p.embedIndex!];
        if (vec) {
          // pgvector accepts the bracketed-list literal as a text input;
          // the column type's implicit cast handles the rest.
          embeddingLiteral = `[${vec.join(',')}]`;
          reembedded++;
        }
      }

      await tx`
        INSERT INTO chunks (
          source_id, page_id, heading, ordinal, content, content_hash, embedding, embedding_model
        ) VALUES (
          ${sourceId}, ${p.pageId}, ${p.chunk.heading}, ${p.chunk.ordinal},
          ${p.chunk.content}, ${p.chunk.contentHash},
          ${embeddingLiteral}, ${modelName}
        )
        ON CONFLICT (page_id, ordinal) DO UPDATE SET
          heading         = EXCLUDED.heading,
          content         = EXCLUDED.content,
          content_hash    = EXCLUDED.content_hash,
          embedding       = EXCLUDED.embedding,
          embedding_model = EXCLUDED.embedding_model
      `;
    }
  });

  return {
    total: allPending.length,
    reembedded,
    skipped,
    failed: oversize + embedFailed,
  };
}


async function insertPage(
  sql: DbClient,
  sourceId: number,
  p: ParsedPage,
): Promise<{ id: number; content_version: number }> {
  const result = await sql<{ id: number; content_version: number }[]>`
    INSERT INTO pages (
      source_id, path, slug, type, title,
      status, author, co_authors, date, supersedes_slug, superseded_by_slug,
      revision_history, frontmatter, body, mtime, hash, is_raw
    ) VALUES (
      ${sourceId}, ${p.path}, ${p.slug}, ${p.type}, ${p.title},
      ${p.status}, ${p.author}, ${sql.json(p.coAuthors as never)},
      ${p.date}, ${p.supersedesSlug}, ${p.supersededBySlug},
      ${sql.json(p.revisionHistory as never)},
      ${sql.json(p.frontmatter as never)},
      ${p.body}, ${p.mtime}, ${p.hash}, ${p.isRaw}
    )
    RETURNING id, content_version::int AS content_version
  `;
  return result[0]!;
}

type CASOutcome =
  | { kind: 'updated' }
  | { kind: 'conflict_concurrent' }
  | { kind: 'conflict_cache_loss' };

async function applyCAS(
  sql: DbClient,
  sourceId: number,
  sourceName: string,
  host: string,
  p: ParsedPage,
  dbRow: DbPageRow,
  syncState: SyncStateFile,
  opts: SyncOptions,
): Promise<CASOutcome> {
  // --full skips ALL CAS — overwrites unconditionally, bumps version.
  if (opts.full) {
    const newVersion = await unconditionalUpdate(sql, sourceId, p);
    setBasedOn(syncState, sourceName, p.path, { version: newVersion, hash: p.hash });
    return { kind: 'updated' };
  }

  const cached = getBasedOn(syncState, sourceName, p.path);

  // Case C.3: cache missing for a page whose body differs from DB.
  // Callers only reach applyCAS when local hash != DB hash (Case B fast-paths
  // hash-match earlier), so the local body has genuinely diverged. With no
  // based-on version to CAS against, we can't tell if this is a fresh local
  // edit on top of the current DB version OR a real concurrent edit.
  // Conservative: log conflict, never overwrite.
  if (!cached) {
    await insertConflict(
      sql, sourceId, dbRow.id, p, host,
      /* base */ null, /* current */ dbRow.content_version, 'cache_loss_fallback',
    );
    return { kind: 'conflict_cache_loss' };
  }

  // Case C.2: cache says X, DB has Y, X !== Y → another host bumped the version.
  if (cached.version !== dbRow.content_version) {
    await insertConflict(
      sql, sourceId, dbRow.id, p, host,
      cached.version, dbRow.content_version, 'concurrent_edit',
    );
    return { kind: 'conflict_concurrent' };
  }

  // Case C.1: cache aligned with DB. CAS UPDATE in a single round-trip via
  // CTE. Postgres MVCC: the outer SELECT sees the snapshot at statement start,
  // so current_version always reflects the pre-update value — even if the
  // CAS succeeded and rewrote the row in the same statement.
  const result = await sql<{ new_version: number | null; current_version: number | null }[]>`
    WITH attempt AS (
      UPDATE pages SET
        slug               = ${p.slug},
        type               = ${p.type},
        title              = ${p.title},
        status             = ${p.status},
        author             = ${p.author},
        co_authors         = ${sql.json(p.coAuthors as never)},
        date               = ${p.date},
        supersedes_slug    = ${p.supersedesSlug},
        superseded_by_slug = ${p.supersededBySlug},
        revision_history   = ${sql.json(p.revisionHistory as never)},
        frontmatter        = ${sql.json(p.frontmatter as never)},
        body               = ${p.body},
        mtime              = ${p.mtime},
        hash               = ${p.hash},
        is_raw             = ${p.isRaw},
        content_version    = content_version + 1,
        updated_at         = now()
       WHERE source_id = ${sourceId}
         AND path = ${p.path}
         AND content_version = ${cached.version}
      RETURNING content_version
    )
    SELECT
      (SELECT content_version::int FROM attempt) AS new_version,
      (SELECT content_version::int FROM pages
        WHERE source_id = ${sourceId} AND path = ${p.path}) AS current_version
  `;
  const row = result[0]!;
  if (row.new_version !== null) {
    setBasedOn(syncState, sourceName, p.path, { version: row.new_version, hash: p.hash });
    return { kind: 'updated' };
  }

  // CAS lost — another host slipped a write in between our snapshot read and
  // our UPDATE. current_version reflects what they wrote.
  await insertConflict(
    sql, sourceId, dbRow.id, p, host,
    cached.version, row.current_version, 'concurrent_edit',
  );
  return { kind: 'conflict_concurrent' };
}

async function unconditionalUpdate(
  sql: DbClient,
  sourceId: number,
  p: ParsedPage,
): Promise<number> {
  const result = await sql<{ content_version: number }[]>`
    UPDATE pages SET
      slug               = ${p.slug},
      type               = ${p.type},
      title              = ${p.title},
      status             = ${p.status},
      author             = ${p.author},
      co_authors         = ${sql.json(p.coAuthors as never)},
      date               = ${p.date},
      supersedes_slug    = ${p.supersedesSlug},
      superseded_by_slug = ${p.supersededBySlug},
      revision_history   = ${sql.json(p.revisionHistory as never)},
      frontmatter        = ${sql.json(p.frontmatter as never)},
      body               = ${p.body},
      mtime              = ${p.mtime},
      hash               = ${p.hash},
      is_raw             = ${p.isRaw},
      content_version    = content_version + 1,
      updated_at         = now()
     WHERE source_id = ${sourceId}
       AND path = ${p.path}
    RETURNING content_version::int AS content_version
  `;
  return result[0]?.content_version ?? 1;
}

async function insertConflict(
  sql: DbClient,
  sourceId: number,
  pageId: number,
  p: ParsedPage,
  host: string,
  baseVersion: number | null,
  currentVersion: number | null,
  cause: 'concurrent_edit' | 'cache_loss_fallback',
): Promise<void> {
  await sql`
    INSERT INTO pages_conflicts (
      source_id, page_id, page_path, detecting_host,
      base_content_version, current_content_version,
      loser_body, loser_frontmatter, cause
    ) VALUES (
      ${sourceId}, ${pageId}, ${p.path}, ${host},
      ${baseVersion}, ${currentVersion},
      ${p.body}, ${sql.json(p.frontmatter as never)}, ${cause}
    )
  `;
}
