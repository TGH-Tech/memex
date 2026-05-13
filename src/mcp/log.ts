/**
 * MCP stdio servers reserve stdout for JSON-RPC. Any rogue `console.log` from
 * the server process corrupts the protocol stream — Claude sees malformed
 * frames and the connection dies. This module is the ONLY way the MCP layer
 * is allowed to talk; everything goes to stderr.
 */

export function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function error(message: string, err?: unknown): void {
  const tail = err === undefined ? '' : `: ${err instanceof Error ? err.message : String(err)}`;
  process.stderr.write(`✘ ${message}${tail}\n`);
}
