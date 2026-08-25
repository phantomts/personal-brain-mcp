/**
 * Stateless MCP request dispatcher for the Streamable HTTP transport.
 *
 * One POST = one JSON-RPC request = one response. There is no session, no
 * initialize handshake, and no server-initiated request channel, which is
 * exactly what the 2026-07-28 revision asks for and what a Cloudflare Worker
 * wants anyway.
 *
 * Legacy revisions (2025-03-26 / 2025-06-18 / 2025-11-25) are still answered
 * on the same endpoint: `initialize` and `ping` are accepted, headers are not
 * enforced, and results omit `resultType` / cache fields.
 */
import {
  RpcError,
  errorResponse,
  invalidParams,
  methodNotFound,
  resultResponse,
  toRpcError,
  INVALID_REQUEST,
  type RequestId,
} from "./jsonrpc";
import { resolveProtocolVersion, validateStandardHeaders } from "./headers";
import {
  LATEST_PROTOCOL_VERSION,
  META,
  SERVER_INFO,
  SUPPORTED_PROTOCOL_VERSIONS,
  isStatelessRevision,
} from "./versions";
import type { ToolRegistry } from "./registry";

/** How long a client may cache our list results. The tool list is static. */
const LIST_TTL_MS = 3_600_000;

const CAPABILITIES = {
  tools: { listChanged: false },
  // Deprecated in 2026-07-28 (SEP-2577) and intentionally not implemented:
  // logging, sampling, roots. Prompts and resources are not offered.
} as const;

const INSTRUCTIONS = [
  "your personal brain: identity, current state, episodic memory and semantic facts,",
  "plus home, vehicles, pets, people, travel, health, finance and household records.",
  "Call `identity` and `get_current_state` at the start of a session for context, `ask_brain`",
  "or `search_memory` for recall, and `quick_capture` to write something down without picking",
  "a table. Read-only tools are annotated with readOnlyHint; everything else writes to Supabase.",
].join(" ");

export interface DispatchDeps {
  registry: ToolRegistry;
}

const JSON_HEADERS = { "content-type": "application/json" };

export async function handleMcpPost(req: Request, deps: DispatchDeps): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(errorResponse(null, { code: -32700, message: "Parse error" }), 400);
  }

  if (Array.isArray(body)) {
    // Batching was removed from the protocol; one message per POST.
    return json(errorResponse(null, { code: INVALID_REQUEST, message: "Batched requests are not supported" }), 400);
  }

  const id = (body.id ?? null) as RequestId;
  const method = String(body.method ?? "");
  const isNotification = body.id === undefined || body.id === null;

  let version: string;
  try {
    version = resolveProtocolVersion(req, body);
  } catch (e) {
    const err = toRpcError(e);
    return json(errorResponse(id, { code: err.code, message: err.message, data: err.data }), err.httpStatus);
  }

  if (isNotification) {
    // No client-to-server notifications are defined for Streamable HTTP; ack
    // legacy ones (notifications/initialized, notifications/cancelled) and move on.
    return new Response(null, { status: 202 });
  }

  try {
    const tool = method === "tools/call" ? deps.registry.get(String((body.params as any)?.name ?? "")) : undefined;
    validateStandardHeaders(req, body, version, tool?.headerParams ?? []);

    if (method === "subscriptions/listen") {
      if (!isStatelessRevision(version)) throw methodNotFound(method);
      return subscriptionStream(id, version);
    }

    const result = await route(method, body, version, deps, tool);
    return json(resultResponse(id, result, version));
  } catch (e) {
    const err = toRpcError(e);
    return json(errorResponse(id, { code: err.code, message: err.message, data: err.data }), err.httpStatus);
  }
}

async function route(
  method: string,
  body: Record<string, unknown>,
  version: string,
  deps: DispatchDeps,
  tool: ReturnType<ToolRegistry["get"]>,
): Promise<Record<string, unknown>> {
  switch (method) {
    case "server/discover":
      return {
        supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        capabilities: CAPABILITIES,
        instructions: INSTRUCTIONS,
        ...cacheFields(version, LIST_TTL_MS),
      };

    case "initialize": {
      // Legacy handshake. Kept so 2025-era clients can still connect.
      if (isStatelessRevision(version)) throw methodNotFound(method);
      const requested = String((body.params as any)?.protocolVersion ?? version);
      return {
        protocolVersion: (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : "2025-11-25",
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      };
    }

    case "ping":
      // Removed in 2026-07-28; answered only for legacy clients.
      if (isStatelessRevision(version)) throw methodNotFound(method);
      return {};

    case "tools/list":
      return {
        tools: deps.registry.list().map((t) => ({
          name: t.name,
          ...(t.title ? { title: t.title } : {}),
          description: t.description,
          inputSchema: t.inputSchema,
          ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
          annotations: t.annotations,
        })),
        ...cacheFields(version, LIST_TTL_MS),
      };

    case "tools/call": {
      const params = (body.params ?? {}) as Record<string, unknown>;
      const name = String(params.name ?? "");
      if (!name) throw invalidParams("params.name is required");
      if (!tool) throw new RpcError(-32602, `Unknown tool: ${name}`, undefined, 200);
      const args = tool.validate(params.arguments ?? {});
      const result = await tool.handler(args, { protocolVersion: version, meta: params._meta });
      return normalizeToolResult(result);
    }

    default:
      throw methodNotFound(method);
  }
}

function normalizeToolResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") {
    return { content: [{ type: "text", text: String(result ?? "") }] };
  }
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.content)) return { ...r, content: [] };
  return r;
}

/** `ttlMs` and `cacheScope` are required on cacheable results from 2026-07-28. */
function cacheFields(version: string, ttlMs: number): Record<string, unknown> {
  if (!isStatelessRevision(version)) return {};
  return { ttlMs, cacheScope: "private" as const };
}

/**
 * `subscriptions/listen` replaces the removed HTTP GET stream and the old
 * resources/subscribe pair. We advertise no list-changed notifications, so the
 * stream acknowledges the filter and then just stays open with keep-alives.
 */
function subscriptionStream(id: RequestId, version: string): Response {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const ack = {
        jsonrpc: "2.0",
        method: "notifications/subscriptions/acknowledged",
        params: {
          _meta: { [META.subscriptionId]: id },
          // Nothing on this server changes its lists at runtime, so we honor
          // no notification types. The stream stays open regardless.
          notifications: {},
        },
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(ack)}\n\n`));
      timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\r\n"));
        } catch {
          if (timer) clearInterval(timer);
        }
      }, 25_000);
    },
    cancel() {
      // Client closing the stream is the cancellation signal.
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "mcp-protocol-version": version || LATEST_PROTOCOL_VERSION,
    },
  });
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
