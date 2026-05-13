import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import pkg from '../../package.json' with { type: 'json' };
import { getClient, type DbClient } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { log, error } from './log.ts';
import { backlinksTool } from './tools/backlinks.ts';
import { getTool } from './tools/get.ts';
import { listTool } from './tools/list.ts';
import { queryTool } from './tools/query.ts';
import { searchTool } from './tools/search.ts';
import { sourcesTool } from './tools/sources.ts';
import { errorResult, type McpTool } from './tools/types.ts';

const TOOLS: McpTool[] = [searchTool, queryTool, getTool, listTool, backlinksTool, sourcesTool];

export async function startMcpServer(): Promise<void> {
  // Session pooler — long-lived connection for the lifetime of the server
  // (PRD §13). One physical connection reused across many tool calls.
  let sql: DbClient;
  try {
    sql = await getClient({ pooler: 'session' });
  } catch (err) {
    error('Failed to connect to Supabase', err);
    process.exit(1);
  }

  try {
    const migResult = await runMigrations(sql);
    if (migResult.applied.length > 0) {
      log(`applied migration(s): ${migResult.applied.join(', ')}`);
    }
  } catch (err) {
    error('Migrations failed', err);
    process.exit(1);
  }

  const server = new Server(
    { name: 'memex', version: pkg.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((t) => t.name === request.params.name);
    if (!tool) {
      // SDK's ServerResult type is a strict union; the CallToolResult branch
      // is what we want, but TS can't narrow without a help. Cast at the
      // boundary — content/isError shape is correct per CallToolResultSchema.
      return errorResult(`Unknown tool: ${request.params.name}`) as never;
    }
    try {
      const result = await tool.handler(sql, request.params.arguments ?? {});
      return result as never;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error(`tool ${tool.name} threw`, err);
      return errorResult(`${tool.name} failed: ${msg}`) as never;
    }
  });

  // Graceful shutdown — close the DB connection when Claude (or a signal) tears
  // down stdin. The `shuttingDown` guard prevents a fast Ctrl-C/Ctrl-C from
  // calling sql.end twice and racing the pool teardown.
  let shuttingDown = false;
  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutting down (${reason})`);
    try {
      await sql.end({ timeout: 1 });
    } catch {
      // best-effort
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log(`memex MCP server ready (${TOOLS.length} tools: ${TOOLS.map((t) => t.name).join(', ')})`);
}
