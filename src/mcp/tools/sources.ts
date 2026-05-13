import { querySources } from '../../queries/sources.ts';
import { jsonResult, type McpTool } from './types.ts';

export const sourcesTool: McpTool = {
  name: 'memex_sources',
  description:
    'List every registered vault, with page counts, last sync timestamp, and ' +
    'the calling host\'s local mount path (or null if the source isn\'t mounted ' +
    'on this machine). Use this first to discover what sources are available ' +
    'before scoping other queries.',
  inputSchema: { type: 'object', properties: {} },
  handler: async (sql) => {
    const rows = await querySources(sql);
    return jsonResult({
      total: rows.length,
      sources: rows.map((r) => ({
        name: r.name,
        pages_count: r.pages_count,
        last_sync: r.last_sync ? new Date(r.last_sync).toISOString() : null,
        last_sync_host: r.last_sync_host,
        mount_path: r.mount_path,
      })),
    });
  },
};
