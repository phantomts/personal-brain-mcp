# Migration to MCP 2026-07-28

This project was originally built against the session-based MCP model: an
HTTP+SSE transport (`GET /sse` + `POST /message`), an `initialize` handshake,
and one shared server object per connection. The
[2026-07-28 revision](https://modelcontextprotocol.io/specification/2026-07-28)
removed all three. This release rewrites the transport layer to match and keeps
a compatibility path for clients still on the 2025 revisions.

## What changed in the spec

Source: [Key Changes: 2026-07-28 vs 2025-11-25](https://modelcontextprotocol.io/specification/2026-07-28/changelog).

| Change | Effect here |
|---|---|
| Protocol-level sessions and `Mcp-Session-Id` removed | The single module-global SSE transport is gone; every POST is independent |
| `initialize` / `notifications/initialized` removed; MCP is stateless | Protocol version and client capabilities now travel in `_meta` on each request |
| `server/discover` is required | Implemented: advertises supported versions, capabilities, and server instructions |
| HTTP `GET` stream, `resources/subscribe` / `unsubscribe` replaced by `subscriptions/listen` | `GET /mcp` returns `405`; `subscriptions/listen` returns a long-lived SSE stream with an acknowledgement and keep-alives |
| `ping`, `logging/setLevel`, `notifications/roots/list_changed` removed | Rejected with `-32601` on 2026-07-28; still answered for legacy clients |
| `resultType` required on all results | Added to every result, with `"complete"` |
| Cacheability fields required on list/read results | `tools/list` and `server/discover` return `ttlMs` and `cacheScope: "private"` |
| Standard request headers required | `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` validated against the body; mismatch is `400` + `-32020` |
| `x-mcp-header` parameter mirroring | Supported: annotations in a tool's `inputSchema` are extracted and the matching `Mcp-Param-*` headers are validated |
| SSE resumability and `Last-Event-ID` removed | Not implemented; a broken stream means the client re-issues the request |
| Deterministic `tools/list` ordering recommended | Tools are always returned sorted by name |
| New error-code range `-32020..-32099` | `HeaderMismatch` `-32020`, `MissingRequiredClientCapability` `-32021`, `UnsupportedProtocolVersion` `-32022` |
| Roots, Sampling, Logging deprecated (SEP-2577) | Not implemented, and not advertised in capabilities |
| HTTP+SSE transport reclassified as Deprecated | `/sse` and `/message` now return `410 Gone` pointing at `/mcp` |
| Tasks moved to the `io.modelcontextprotocol/tasks` extension | Not implemented; no tool here runs long enough to need it |

## What changed in this repo

- **New endpoint:** `POST /mcp`. `GET`/`DELETE` on it return `405`.
- **Removed:** `GET /sse` and `POST /message` (now `410 Gone` with a pointer),
  and with them the module-global `activeTransport`, which was also a real
  concurrency bug — two clients shared one transport.
- **Removed dependency:** `@modelcontextprotocol/sdk`. As of 1.30.0 the SDK's
  `LATEST_PROTOCOL_VERSION` is still `2025-11-25` and it has no `server/discover`,
  so the 2026-07-28 behavior is implemented directly in `src/protocol/`. The
  protocol is stateless now, which makes this a small amount of code. Revisit
  when the SDK ships 2026-07-28 support.
- **New `src/protocol/`:**
  - `versions.ts` — supported revisions, server identity, `_meta` key names
  - `jsonrpc.ts` — envelopes, error codes, `resultType` / `serverInfo` finalization
  - `headers.ts` — standard header validation, base64 sentinel decoding, `Origin` checks
  - `registry.ts` — tool catalog, JSON Schema generation, deterministic ordering
  - `annotations.ts` — per-tool `readOnly` / `destructive` / `idempotent` / `openWorld` hints
  - `dispatch.ts` — the stateless request router
- **Tool files are unchanged** apart from one import line. They still call
  `server.tool(name, description, zodShape, handler)`; the registry implements
  that surface and adds the wire metadata.
- **Annotations:** every tool now ships hints. The read-only set was derived by
  auditing each handler for Supabase writes, so a client can decide what needs a
  confirmation prompt. Keep `src/protocol/annotations.ts` current when a tool
  gains a write path.
- **Structured output:** `okStructured()` plus an `outputSchema` on the tool.
  `search_memory` is converted as the reference; the remaining tools still
  return text only, which stays spec-valid.
- **Auth:** static bearer is still the default. Setting `OAUTH_ISSUER` and
  `MCP_RESOURCE` switches the server into OAuth 2.1 resource-server mode with
  RFC 9728 Protected Resource Metadata at
  `/.well-known/oauth-protected-resource`, `WWW-Authenticate` challenges that
  carry `resource_metadata` and `scope`, and RFC 8707 audience validation so a
  token minted for another resource is rejected.
- **DNS-rebinding protection:** requests carrying a browser `Origin` must match
  `MCP_ALLOWED_ORIGINS`, otherwise `403`.

## Reconnecting clients

Point clients at `/mcp` instead of `/sse`:

```json
{
  "mcpServers": {
    "personal-brain": {
      "url": "https://YOUR-WORKER.workers.dev/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

Clients that only speak HTTP+SSE need the [`mcp-remote`](https://github.com/geelen/mcp-remote)
shim, which talks Streamable HTTP upstream. Clients on the 2025 revisions work
against `/mcp` unchanged: `initialize` and `ping` are still answered, standard
headers are not enforced, and results omit the 2026-only fields.

## Verifying a deploy

```bash
BASE=https://YOUR-WORKER.workers.dev
TOKEN=...

# Health, including which revisions are supported
curl -s $BASE/health | jq

# server/discover
curl -s -X POST $BASE/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: server/discover" \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}' | jq

# A tool call (note the required Mcp-Name header)
curl -s -X POST $BASE/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/call" \
  -H "Mcp-Name: get_current_state" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_current_state","arguments":{},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}' | jq

# Header validation should fail this one with -32020
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

`npm test` covers discover, deterministic listing, header validation including
base64 sentinel names, version negotiation errors, removed methods, tool-call
results, the legacy path, the subscription stream, and OAuth claim validation.

## Still open

- `outputSchema` / `structuredContent` for the remaining 53 tools.
- Tasks extension, and a re-evaluation once the TypeScript SDK supports
  2026-07-28 natively.
