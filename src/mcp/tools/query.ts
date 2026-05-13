import { z } from 'zod';
import { runHybridQuery } from '../../queries/query.ts';
import { errorResult, formatZodError, jsonResult, type McpTool } from './types.ts';

const InputSchema = z.object({
  query: z.string().trim().min(1),
  source: z.string().optional(),
  top_k: z.number().int().positive().optional(),
  no_expand: z.boolean().optional(),
});

export const queryTool: McpTool = {
  name: 'memex_query',
  description:
    'Hybrid semantic + keyword retrieval. Embeds the query (and up to 3 GPT-' +
    'generated paraphrases when scoped to a single source), runs vector search ' +
    'against page chunks plus a tsvector keyword search, fuses results via RRF, ' +
    're-ranks by cosine similarity to the original query, and boosts pages with ' +
    'many inbound wikilinks. Use this when the user is asking a question or ' +
    'describing intent rather than naming exact terms. For exact-term lookup ' +
    'prefer `memex_search`. Federated by default; pass `source` for a vault-scoped ' +
    'query (which also enables query expansion).',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural-language question or descriptive search query.',
      },
      source: {
        type: 'string',
        description:
          'Restrict to one source name (also enables query expansion). Omit for federated.',
      },
      top_k: {
        type: 'integer',
        description: 'Max results to return. Default 10.',
        minimum: 1,
      },
      no_expand: {
        type: 'boolean',
        description: 'Disable query expansion even when a source is specified.',
      },
    },
    required: ['query'],
  },
  handler: async (sql, input) => {
    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      return errorResult(`Invalid input: ${formatZodError(parsed.error)}`);
    }
    const { query, source, top_k, no_expand } = parsed.data;
    const report = await runHybridQuery(sql, query, {
      ...(source !== undefined ? { source } : {}),
      ...(top_k !== undefined ? { topK: top_k } : {}),
      ...(no_expand ? { noExpand: true } : {}),
    });
    return jsonResult({
      query: report.query,
      source: source ?? '(federated)',
      expansions: report.expansions,
      expansion_source: report.expansionSource,
      vector_enabled: report.vectorEnabled,
      degradations: report.degradations,
      dedup_stats: report.dedupStats,
      duration_ms: report.durationMs,
      total_results: report.rows.length,
      results: report.rows.map((r) => ({
        source: r.source,
        slug: r.slug,
        path: r.path,
        type: r.type,
        title: r.title,
        heading: r.heading,
        content: r.content,
        snippet: r.snippet?.replace(/\s+/g, ' ').trim() ?? null,
        score: Number(r.score.toFixed(4)),
        cosine_sim: Number(r.cosineSim.toFixed(4)),
        backlinks: r.backlinks,
        ranks: r.ranks,
        citation: `[${r.source}] ${r.slug}`,
      })),
    });
  },
};
