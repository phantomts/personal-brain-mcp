/**
 * Standard MCP request-header validation for Streamable HTTP (2026-07-28).
 *
 * Required on every POST to the MCP endpoint:
 *   MCP-Protocol-Version   must equal _meta["io.modelcontextprotocol/protocolVersion"]
 *   Mcp-Method             must equal the JSON-RPC `method`
 *   Mcp-Name               required for tools/call, resources/read, prompts/get
 *
 * Values that cannot be carried as plain ASCII use the base64 sentinel form
 * `=?base64?<value>?=`. Servers must decode before comparing.
 */
import { headerMismatch } from "./jsonrpc";
import { META, DEFAULT_LEGACY_VERSION, isStatelessRevision, isSupportedVersion } from "./versions";
import { unsupportedProtocolVersion } from "./jsonrpc";

const SENTINEL_PREFIX = "=?base64?";
const SENTINEL_SUFFIX = "?=";

/** Methods whose `Mcp-Name` header is required, and where its value comes from. */
const NAME_SOURCE: Record<string, "name" | "uri"> = {
  "tools/call": "name",
  "prompts/get": "name",
  "resources/read": "uri",
};

export function decodeHeaderValue(raw: string): string {
  if (raw.startsWith(SENTINEL_PREFIX) && raw.endsWith(SENTINEL_SUFFIX)) {
    const b64 = raw.slice(SENTINEL_PREFIX.length, raw.length - SENTINEL_SUFFIX.length);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return raw;
}

/**
 * Resolve the protocol version for a request and enforce header/body
 * agreement. Throws RpcError (HeaderMismatch / UnsupportedProtocolVersion).
 */
export function resolveProtocolVersion(req: Request, body: Record<string, unknown>): string {
  const header = req.headers.get("mcp-protocol-version");
  const params = (body.params ?? {}) as Record<string, unknown>;
  const meta = (params._meta ?? {}) as Record<string, unknown>;
  const inBody = typeof meta[META.protocolVersion] === "string" ? (meta[META.protocolVersion] as string) : undefined;

  if (!header && !inBody) {
    // Permitted only because we still support pre-2025-06-18 clients.
    return DEFAULT_LEGACY_VERSION;
  }
  // The header and the body value must agree whenever both are present.
  if (header && inBody && header !== inBody) {
    throw headerMismatch(
      `MCP-Protocol-Version header value '${header}' does not match body value '${inBody}'`,
    );
  }

  const version = header ?? inBody!;
  if (!isSupportedVersion(version)) throw unsupportedProtocolVersion(version);

  if (isStatelessRevision(version)) {
    if (!header) throw headerMismatch("MCP-Protocol-Version header is required");
    if (!inBody) {
      throw headerMismatch(`params._meta["${META.protocolVersion}"] is required`);
    }
  }
  return version;
}

/**
 * Validate Mcp-Method, Mcp-Name and any Mcp-Param-* headers against the body.
 * Only enforced for revisions that require them (2026-07-28+).
 */
export function validateStandardHeaders(
  req: Request,
  body: Record<string, unknown>,
  protocolVersion: string,
  headerParams: Array<{ header: string; path: string[] }> = [],
): void {
  if (!isStatelessRevision(protocolVersion)) return;

  const method = String(body.method ?? "");
  const methodHeader = req.headers.get("mcp-method");
  if (!methodHeader) throw headerMismatch("Mcp-Method header is required");
  if (methodHeader !== method) {
    throw headerMismatch(`Mcp-Method header value '${methodHeader}' does not match body value '${method}'`);
  }

  const source = NAME_SOURCE[method];
  if (source) {
    const params = (body.params ?? {}) as Record<string, unknown>;
    const expected = params[source];
    const nameHeader = req.headers.get("mcp-name");
    if (typeof expected !== "string" || expected.length === 0) {
      throw headerMismatch(`params.${source} is required for ${method}`);
    }
    if (!nameHeader) throw headerMismatch("Mcp-Name header is required");
    if (decodeHeaderValue(nameHeader) !== expected) {
      throw headerMismatch(
        `Mcp-Name header value '${nameHeader}' does not match body value '${expected}'`,
      );
    }
  }

  for (const { header, path } of headerParams) {
    const value = readPath((body.params as Record<string, unknown>)?.arguments, path);
    const supplied = req.headers.get(`mcp-param-${header.toLowerCase()}`);
    if (value === undefined || value === null) {
      if (supplied !== null) {
        throw headerMismatch(`Mcp-Param-${header} sent but ${path.join(".")} is absent from the body`);
      }
      continue;
    }
    if (supplied === null) throw headerMismatch(`Mcp-Param-${header} header is required`);
    const decoded = decodeHeaderValue(supplied);
    const matches =
      typeof value === "number"
        ? Number(decoded) === value
        : typeof value === "boolean"
          ? decoded === String(value)
          : decoded === String(value);
    if (!matches) {
      throw headerMismatch(`Mcp-Param-${header} header value '${decoded}' does not match body value '${String(value)}'`);
    }
  }
}

function readPath(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * DNS-rebinding protection. The spec requires rejecting an invalid `Origin`
 * with 403. A request without an Origin header (a native MCP client, curl,
 * an iPhone Shortcut) is allowed; browser-originated requests must be on the
 * allowlist.
 */
export function originAllowed(req: Request, allowList: string | undefined): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const allowed = (allowList ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.includes("*")) return true;
  return allowed.includes(origin);
}
