/**
 * Protocol version support.
 *
 * The server speaks the 2026-07-28 revision natively (stateless, no
 * initialize handshake, `server/discover`, required request headers) and
 * keeps a compatibility path for the older session-based revisions that
 * today's clients still ship.
 *
 * Spec: https://modelcontextprotocol.io/specification/2026-07-28
 */

/** Newest revision this server implements. */
export const LATEST_PROTOCOL_VERSION = "2026-07-28";

/**
 * Every revision we accept, newest first. Advertised verbatim in
 * `server/discover` and in UnsupportedProtocolVersionError.data.supported.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;

export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

/**
 * Version assumed when a client omits `MCP-Protocol-Version` entirely.
 * The spec permits this only for servers that still support pre-2025-06-18
 * clients, which we do.
 */
export const DEFAULT_LEGACY_VERSION = "2025-03-26";

export function isSupportedVersion(v: string): v is ProtocolVersion {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(v);
}

/**
 * True for revisions that removed protocol sessions and the initialize
 * handshake, and that require `resultType`, `ttlMs`, and `cacheScope`.
 */
export function isStatelessRevision(v: string): boolean {
  return v >= "2026-07-28";
}

export const SERVER_INFO = {
  name: "personal-brain",
  title: "Personal Brain",
  version: "0.6.0",
} as const;

/** Meta keys defined by the 2026-07-28 revision. */
export const META = {
  protocolVersion: "io.modelcontextprotocol/protocolVersion",
  clientInfo: "io.modelcontextprotocol/clientInfo",
  clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
  logLevel: "io.modelcontextprotocol/logLevel",
  serverInfo: "io.modelcontextprotocol/serverInfo",
  subscriptionId: "io.modelcontextprotocol/subscriptionId",
} as const;
