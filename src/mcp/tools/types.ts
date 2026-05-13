import type { z } from 'zod';
import type { DbClient } from '../../db/client.ts';

/**
 * A registered MCP tool. `inputSchema` is a JSON Schema object the SDK
 * forwards to Claude; `handler` is the actual implementation.
 *
 * Output convention (Option A from the plan): one text content block
 * containing pretty-printed JSON. Claude reads the JSON and reasons over it.
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (sql: DbClient, input: unknown) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function jsonResult(data: unknown): ToolResult {
  return {
    content: [
      { type: 'text', text: JSON.stringify(data, null, 2) },
    ],
  };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/**
 * Collapse zod's structured error into a single short line per issue. The raw
 * `error.message` is a JSON dump of the full issues array — too noisy for a
 * tool error surface.
 */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => {
      const path = i.path.length > 0 ? `${i.path.join('.')}: ` : '';
      return `${path}${i.message}`;
    })
    .join('; ');
}
