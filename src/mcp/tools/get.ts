import { z } from 'zod';
import { queryGet } from '../../queries/get.ts';
import { errorResult, formatZodError, jsonResult, type McpTool } from './types.ts';

const InputSchema = z.object({
  slug: z.string().min(1),
  source: z.string().min(1),
});

export const getTool: McpTool = {
  name: 'memex_get',
  description:
    'Fetch the full content of one indexed page by slug. Returns typed frontmatter ' +
    '(status, author, date, supersedes_slug, etc.), the unstructured frontmatter ' +
    'blob, and the markdown body. Use after memex_search or memex_list to read a ' +
    'specific page in full.',
  inputSchema: {
    type: 'object',
    properties: {
      slug: {
        type: 'string',
        description: 'Page slug (e.g. "decisions/cart-currency-locked-by-first-item").',
      },
      source: {
        type: 'string',
        description: 'Source name. Required because slugs are not unique across sources.',
      },
    },
    required: ['slug', 'source'],
  },
  handler: async (sql, input) => {
    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      return errorResult(`Invalid input: ${formatZodError(parsed.error)}`);
    }
    const { slug, source } = parsed.data;
    const row = await queryGet(sql, slug, source);
    if (!row) {
      return errorResult(`Page "${slug}" not found in source "${source}".`);
    }
    return jsonResult({
      source: row.source,
      path: row.path,
      slug: row.slug,
      type: row.type,
      title: row.title,
      status: row.status,
      author: row.author,
      co_authors: row.co_authors,
      date: row.date ? new Date(row.date).toISOString().slice(0, 10) : null,
      supersedes_slug: row.supersedes_slug,
      superseded_by_slug: row.superseded_by_slug,
      revision_history: row.revision_history,
      frontmatter_extra: row.frontmatter,
      body: row.body,
      content_version: row.content_version,
    });
  },
};
