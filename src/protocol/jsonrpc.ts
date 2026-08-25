/**
 * JSON-RPC 2.0 envelope helpers and MCP error codes.
 *
 * Error-code allocation follows the 2026-07-28 policy: -32000..-32019 is
 * implementation-defined, -32020..-32099 is reserved for the spec.
 */
import { META, SERVER_INFO, SUPPORTED_PROTOCOL_VERSIONS, isStatelessRevision } from "./versions";

export type RequestId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: RequestId;
  method: string;
  params?: Record<string, unknown>;
}

// Standard JSON-RPC codes
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

// MCP-reserved codes (2026-07-28)
export const HEADER_MISMATCH = -32020;
export const MISSING_REQUIRED_CLIENT_CAPABILITY = -32021;
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

export interface RpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

/** Thrown by handlers to produce a protocol-level error response. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
    readonly httpStatus = 400,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export function headerMismatch(message: string): RpcError {
  return new RpcError(HEADER_MISMATCH, `Header mismatch: ${message}`, undefined, 400);
}

export function unsupportedProtocolVersion(requested: string): RpcError {
  return new RpcError(
    UNSUPPORTED_PROTOCOL_VERSION,
    `Unsupported protocol version: ${requested}`,
    { supported: [...SUPPORTED_PROTOCOL_VERSIONS], requested },
    400,
  );
}

export function methodNotFound(method: string): RpcError {
  // Spec maps unknown RPC methods to HTTP 404 with JSON-RPC -32601.
  return new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`, undefined, 404);
}

export function invalidParams(message: string, data?: unknown): RpcError {
  return new RpcError(INVALID_PARAMS, message, data, 200);
}

/**
 * Finalize a result object for the wire.
 *
 * For 2026-07-28 and later we add the required `resultType` and the
 * recommended `_meta["io.modelcontextprotocol/serverInfo"]`. Older revisions
 * get the result untouched so strict legacy clients see exactly what their
 * schema expects.
 */
export function finalizeResult(
  result: Record<string, unknown>,
  protocolVersion: string,
): Record<string, unknown> {
  if (!isStatelessRevision(protocolVersion)) return result;
  const meta = { ...(result._meta as Record<string, unknown> | undefined) };
  meta[META.serverInfo] = SERVER_INFO;
  return { resultType: "complete", ...result, _meta: meta };
}

export function resultResponse(
  id: RequestId,
  result: Record<string, unknown>,
  protocolVersion: string,
): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result: finalizeResult(result, protocolVersion) };
}

export function errorResponse(id: RequestId, err: RpcErrorShape): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: err.data === undefined ? { code: err.code, message: err.message } : err,
  };
}

export function toRpcError(e: unknown): RpcError {
  if (e instanceof RpcError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new RpcError(INTERNAL_ERROR, message, undefined, 500);
}
