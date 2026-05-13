import { z } from 'zod';
import { queryBacklinks } from '../../queries/backlinks.ts';
import { errorResult, formatZodError, jsonResult, type McpTool } from './types.ts';

const InputSchema = z.object({
  slug: z.string().min(1),
  source: z.string().optional(),
});

export const backlinksTool: McpTool = {
  name: 'memex_backlinks',
  description:
    'Find inbound wikilinks pointing AT a slug. Wikilink-only (does not match plain ' +
    'text mentions). Useful for "what cites this concept" or "what decisions reference ' +
    'this bug". Federated across all sources unless `source` is given.',
  inputSchema: {
    type: 'object',
    properties: {
      slug: { type: 'string', description: 'Target slug (e.g. "concepts/lazy-upsert").' },
      source: { type: 'string', description: 'Restrict to one source.' },
    },
    required: ['slug'],
  },
  handler: async (sql, input) => {
    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      return errorResult(`Invalid input: ${formatZodError(parsed.error)}`);
    }
    const { slug, source } = parsed.data;
    const rows = await queryBacklinks(sql, slug, source ? { source } : {});
    const total_occurrences = rows.reduce((n, r) => n + r.occurrences, 0);
    return jsonResult({
      target: slug,
      source: source ?? '(federated)',
      citing_pages: rows.length,
      total_occurrences,
      inbound: rows,
    });
  },
};
