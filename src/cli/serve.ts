import { startMcpServer } from '../mcp/server.ts';

export async function runServe(opts: { mcp?: boolean }): Promise<void> {
  if (!opts.mcp) {
    console.error('✘ memex serve currently only supports --mcp (stdio MCP server).');
    process.exit(1);
  }
  await startMcpServer();
  // startMcpServer never returns under normal operation; it hands off to the
  // SDK's stdio transport which blocks until the client disconnects or a
  // signal arrives.
}
