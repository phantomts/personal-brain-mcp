/**
 * Authorization for the MCP endpoint.
 *
 * Two modes, chosen by configuration:
 *
 * 1. Static bearer (default). Authorization is OPTIONAL in MCP, and for a
 *    single-user personal server a long random token in Wrangler secrets is a
 *    reasonable trust boundary.
 * 2. OAuth 2.1 resource server (set OAUTH_ISSUER + MCP_RESOURCE). The server
 *    then publishes RFC 9728 Protected Resource Metadata, points at it from
 *    every `WWW-Authenticate` challenge, and validates the access token's
 *    signature, issuer, expiry and — per RFC 8707 — that this server is the
 *    intended audience.
 *
 * Spec: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
 */
import type { Env } from "./index";

export interface AuthResult {
  ok: boolean;
  response?: Response;
  scopes?: string[];
  subject?: string;
}

const REQUIRED_SCOPE = "mcp:tools";

export function oauthEnabled(env: Env): boolean {
  return Boolean(env.OAUTH_ISSUER && env.MCP_RESOURCE);
}

/** RFC 9728 metadata document, served at /.well-known/oauth-protected-resource. */
export function protectedResourceMetadata(env: Env): Response {
  if (!oauthEnabled(env)) return new Response("not found", { status: 404 });
  const body = {
    resource: env.MCP_RESOURCE,
    authorization_servers: [env.OAUTH_ISSUER],
    bearer_methods_supported: ["header"],
    // No offline_access: refresh tokens are not a resource requirement.
    scopes_supported: [REQUIRED_SCOPE],
    resource_documentation: env.MCP_RESOURCE ? `${trimSlash(env.MCP_RESOURCE)}/health` : undefined,
  };
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", "cache-control": "max-age=3600" },
  });
}

export async function authorize(req: Request, env: Env): Promise<AuthResult> {
  const token = bearerToken(req);
  if (!token) return { ok: false, response: challenge(env, 401, "missing access token") };

  if (!oauthEnabled(env)) {
    if (!env.MCP_BEARER_TOKEN || !constantTimeEqual(token, env.MCP_BEARER_TOKEN)) {
      return { ok: false, response: challenge(env, 401, "invalid token") };
    }
    return { ok: true, scopes: [REQUIRED_SCOPE], subject: "static-bearer" };
  }

  try {
    const claims = await verifyJwt(token, env);
    const scopes = String(claims.scope ?? "").split(/\s+/).filter(Boolean);
    if (scopes.length && !hasScope(scopes, REQUIRED_SCOPE)) {
      return { ok: false, response: challenge(env, 403, "insufficient_scope") };
    }
    return { ok: true, scopes, subject: String(claims.sub ?? "unknown") };
  } catch (e) {
    return { ok: false, response: challenge(env, 401, e instanceof Error ? e.message : "invalid token") };
  }
}

/**
 * WWW-Authenticate challenge. Includes `resource_metadata` so a client can
 * discover the authorization server, and `scope` so it knows what to ask for.
 */
function challenge(env: Env, status: 401 | 403, description: string): Response {
  const parts = [`Bearer realm="mcp"`];
  if (status === 403) parts.push(`error="insufficient_scope"`);
  else if (description !== "missing access token") parts.push(`error="invalid_token"`);
  parts.push(`scope="${REQUIRED_SCOPE}"`);
  if (oauthEnabled(env)) {
    parts.push(`resource_metadata="${trimSlash(env.MCP_RESOURCE!)}/.well-known/oauth-protected-resource"`);
  }
  parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  return new Response(JSON.stringify({ error: status === 403 ? "insufficient_scope" : "invalid_token" }), {
    status,
    headers: { "www-authenticate": parts.join(", "), "content-type": "application/json" },
  });
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function hasScope(granted: string[], required: string): boolean {
  // Account for hierarchy: a broader scope implies narrower ones.
  const prefix = required.split(":")[0]!;
  return granted.includes(required) || granted.includes(prefix) || granted.includes(`${prefix}:*`);
}

/* ------------------------------- JWT verify ------------------------------- */

interface Jwks {
  keys: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }>;
}

let jwksCache: { url: string; fetchedAt: number; jwks: Jwks } | null = null;

async function loadJwks(env: Env): Promise<Jwks> {
  const issuer = trimSlash(env.OAUTH_ISSUER!);
  const url = env.OAUTH_JWKS_URL ?? `${issuer}/.well-known/jwks.json`;
  if (jwksCache && jwksCache.url === url && Date.now() - jwksCache.fetchedAt < 3_600_000) {
    return jwksCache.jwks;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`jwks fetch failed (${res.status})`);
  const jwks = (await res.json()) as Jwks;
  jwksCache = { url, fetchedAt: Date.now(), jwks };
  return jwks;
}

async function verifyJwt(token: string, env: Env): Promise<Record<string, unknown>> {
  const [headerB64, payloadB64, sigB64] = token.split(".");
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error("malformed token");

  const header = JSON.parse(b64urlToText(headerB64)) as { alg?: string; kid?: string };
  const claims = JSON.parse(b64urlToText(payloadB64)) as Record<string, unknown>;

  const algo = header.alg === "ES256"
    ? { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" }
    : header.alg === "RS256"
      ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
      : null;
  if (!algo) throw new Error(`unsupported alg ${header.alg}`);

  const jwks = await loadJwks(env);
  const jwk = jwks.keys.find((k) => !header.kid || k.kid === header.kid);
  if (!jwk) throw new Error("no matching jwk");

  const key = await crypto.subtle.importKey("jwk", jwk, algo as any, false, ["verify"]);
  const verified = await crypto.subtle.verify(
    header.alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" },
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!verified) throw new Error("signature verification failed");

  assertClaims(claims, env);
  return claims;
}

/** Exported for tests: issuer, expiry and RFC 8707 audience binding. */
export function assertClaims(claims: Record<string, unknown>, env: Env, now = Date.now()): void {
  const issuer = trimSlash(env.OAUTH_ISSUER ?? "");
  if (trimSlash(String(claims.iss ?? "")) !== issuer) throw new Error("issuer mismatch");

  const exp = Number(claims.exp ?? 0);
  if (!exp || exp * 1000 <= now) throw new Error("token expired");
  const nbf = Number(claims.nbf ?? 0);
  if (nbf && nbf * 1000 > now + 60_000) throw new Error("token not yet valid");

  const resource = trimSlash(env.MCP_RESOURCE ?? "");
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud.map(String) : aud ? [String(aud)] : [];
  if (!audiences.map(trimSlash).includes(resource)) {
    // Never accept a token minted for a different resource.
    throw new Error("audience mismatch");
  }
}

/* -------------------------------- helpers -------------------------------- */

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function b64urlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function b64urlToText(input: string): string {
  return new TextDecoder().decode(b64urlToBytes(input));
}
