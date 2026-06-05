/**
 * Bearer-token auth middleware.
 *
 * Compares the Authorization header against MCP_BEARER_TOKEN in constant time
 * to prevent timing attacks. Returns a Response if the request should be
 * rejected, otherwise null.
 */
import type { Env } from "./index";

export function requireAuth(req: Request, env: Env): Response | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const supplied = match?.[1]?.trim() ?? "";

  if (!constantTimeEqual(supplied, env.MCP_BEARER_TOKEN)) {
    return new Response("unauthorized", {
      status: 401,
      headers: { "www-authenticate": 'Bearer realm="mcp"' },
    });
  }
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
