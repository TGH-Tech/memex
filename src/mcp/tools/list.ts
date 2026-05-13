import { z } from 'zod';
import { queryList } from '../../queries/list.ts';
import { errorResult, formatZodError, jsonResult, type McpTool } from './types.ts';

const InputSchema = z.object({
  source: z.string().optional(),
  type: z.string().optional(),
});

export const listTool: McpTool = {
  name: 'memex_list',
  description:
    'List indexed pages. Optionally filter by source and/or type ' +
    '(decision | flow | bug | concept | feature | session | other). Federated across ' +
    'all sources unless `source` is given. Returns lightweight rows ' +
    '(slug, type, title) — use memex_get to read a specific page.',
  inputSchema: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Restrict to one source name.' },
      type: { type: 'string', description: 'Restrict to one type.' },
    },
  },
  handler: async (sql, input) => {
    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      return errorResult(`Invalid input: ${formatZodError(parsed.error)}`);
    }
    const rows = await queryList(sql, parsed.data);
    return jsonResult({
      total: rows.length,
      pages: rows,
    });
  },
};
