/**
 * Tool result helpers. MCP tools return a structured content array.
 * These helpers keep formatting consistent across tools.
 */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function fail(message: string, cause?: unknown): ToolResult {
  const detail = cause instanceof Error ? `\n${cause.message}` : "";
  return { content: [{ type: "text", text: `error: ${message}${detail}` }], isError: true };
}
