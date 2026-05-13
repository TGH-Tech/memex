import { z } from 'zod';
import { querySearch } from '../../queries/search.ts';
import { errorResult, formatZodError, jsonResult, type McpTool } from './types.ts';

// trim() before min(1) so whitespace-only queries (`" "`) get rejected here
// instead of slipping through to websearch_to_tsquery as zero-result garbage.
// Matches the CLI's `query.trim().length === 0` early-exit.
const InputSchema = z.object({
  query: z.string().trim().min(1),
  source: z.string().optional(),
  top_k: z.number().int().positive().optional(),
});

export const searchTool: McpTool = {
  name: 'memex_search',
  description:
    'Ranked keyword search over indexed markdown pages. Returns pages with relevance ' +
    'rank and highlighted snippets (matches wrapped in « »). Supports Google-style ' +
    'syntax: "exact phrase", cart OR currency, cart -session. Use this first when ' +
    'looking for engineering decisions, flows, concepts, etc. Federated across all ' +
    'sources unless `source` is given.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search terms. Supports phrases ("..."), OR, and -exclusion.',
      },
      source: {
        type: 'string',
        description: 'Restrict to one source name (e.g. "e-commerce"). Omit to search all.',
      },
      top_k: {
        type: 'integer',
        description: 'Max results. Default 10.',
        minimum: 1,
      },
    },
    required: ['query'],
  },
  handler: async (sql, input) => {
    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      return errorResult(`Invalid input: ${formatZodError(parsed.error)}`);
    }
    const { query, source, top_k } = parsed.data;
    const rows = await querySearch(sql, query, {
      ...(source !== undefined ? { source } : {}),
      ...(top_k !== undefined ? { topK: top_k } : {}),
    });
    return jsonResult({
      query,
      source: source ?? '(federated)',
      total_results: rows.length,
      results: rows.map((r) => ({
        source: r.source,
        slug: r.slug,
        type: r.type,
        title: r.title,
        rank: Number(r.rank.toFixed(4)),
        snippet: r.snippet?.replace(/\s+/g, ' ').trim() ?? null,
        citation: `[${r.source}] ${r.slug}`,
      })),
    });
  },
};
