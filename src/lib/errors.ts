/**
 * Tool result helpers. MCP tools return a content array, and optionally a
 * machine-readable `structuredContent` payload alongside it.
 * These helpers keep formatting consistent across tools.
 */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

export function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Return prose for the model plus structured data for the client.
 *
 * Use this whenever a tool has a stable output shape, and declare that shape
 * as the tool's `outputSchema` so clients can rely on it. `search_memory` is
 * the reference implementation.
 */
export function okStructured(text: string, data: unknown): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: data };
}

export function fail(message: string, cause?: unknown): ToolResult {
  const detail = cause instanceof Error ? `\n${cause.message}` : "";
  return { content: [{ type: "text", text: `error: ${message}${detail}` }], isError: true };
}
