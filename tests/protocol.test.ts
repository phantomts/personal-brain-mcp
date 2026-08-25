/**
 * Protocol conformance tests for the 2026-07-28 Streamable HTTP transport
 * and the legacy compatibility path. No Supabase or network access needed —
 * the dispatcher is fed a registry with one fake tool.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { handleMcpPost } from "../src/protocol/dispatch";
import { ToolRegistry } from "../src/protocol/registry";
import { decodeHeaderValue } from "../src/protocol/headers";
import { assertClaims } from "../src/auth";
import { LATEST_PROTOCOL_VERSION, META } from "../src/protocol/versions";

const V = LATEST_PROTOCOL_VERSION;

const echoInput = { text: z.string().min(1) };
const lastInput = { n: z.number().optional() };

function registry(): ToolRegistry {
  const r = new ToolRegistry();
  r.tool("echo", { description: "Echo text back", inputSchema: echoInput }, async ({ text }) => ({
    content: [{ type: "text", text }],
  }));
  r.tool("zzz_last", { description: "Sorts last", inputSchema: lastInput }, async () => ({
    content: [{ type: "text", text: "ok" }],
  }));
  return r;
}

function post(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  url = "https://mcp.example.com/mcp",
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function rpc(method: string, params: Record<string, unknown> = {}, version = V, id: number | string = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        [META.protocolVersion]: version,
        [META.clientCapabilities]: {},
        [META.clientInfo]: { name: "test-client", version: "0.0.0" },
        ...((params._meta as object) ?? {}),
      },
    },
  };
}

function stdHeaders(method: string, name?: string, version = V): Record<string, string> {
  return {
    "mcp-protocol-version": version,
    "mcp-method": method,
    ...(name ? { "mcp-name": name } : {}),
  };
}

async function call(body: Record<string, unknown>, headers: Record<string, string>) {
  const res = await handleMcpPost(post(body, headers), { registry: registry() });
  const text = await res.text();
  return { res, json: text ? JSON.parse(text) : null };
}

describe("server/discover", () => {
  it("advertises supported versions, capabilities and cache hints", async () => {
    const { res, json } = await call(rpc("server/discover"), stdHeaders("server/discover"));
    expect(res.status).toBe(200);
    expect(json.result.supportedVersions).toContain(V);
    expect(json.result.capabilities.tools).toBeDefined();
    expect(json.result.resultType).toBe("complete");
    expect(typeof json.result.ttlMs).toBe("number");
    expect(json.result.cacheScope).toBe("private");
    expect(json.result._meta[META.serverInfo].name).toBe("personal-brain");
  });
});

describe("tools/list", () => {
  it("is deterministically ordered and cacheable", async () => {
    const { json } = await call(rpc("tools/list"), stdHeaders("tools/list"));
    const names = json.result.tools.map((t: any) => t.name);
    expect(names).toEqual([...names].sort());
    expect(json.result.ttlMs).toBeGreaterThan(0);
  });

  it("emits JSON Schema inputs and honest annotations", async () => {
    const { json } = await call(rpc("tools/list"), stdHeaders("tools/list"));
    const echo = json.result.tools.find((t: any) => t.name === "echo");
    expect(echo.inputSchema.type).toBe("object");
    expect(echo.inputSchema.properties.text).toBeDefined();
    expect(echo.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: false });
  });
});

describe("header validation", () => {
  it("rejects a missing Mcp-Method header with -32020", async () => {
    const { res, json } = await call(rpc("tools/list"), { "mcp-protocol-version": V });
    expect(res.status).toBe(400);
    expect(json.error.code).toBe(-32020);
  });

  it("rejects a header/body protocol-version mismatch", async () => {
    const { res, json } = await call(rpc("tools/list", {}, V), stdHeaders("tools/list", undefined, "2025-11-25"));
    expect(res.status).toBe(400);
    expect(json.error.code).toBe(-32020);
  });

  it("rejects a Mcp-Name that does not match params.name", async () => {
    const body = rpc("tools/call", { name: "echo", arguments: { text: "hi" } });
    const { res, json } = await call(body, stdHeaders("tools/call", "not_echo"));
    expect(res.status).toBe(400);
    expect(json.error.code).toBe(-32020);
  });

  it("accepts a base64-sentinel Mcp-Name", async () => {
    const encoded = `=?base64?${Buffer.from("echo", "utf8").toString("base64")}?=`;
    const body = rpc("tools/call", { name: "echo", arguments: { text: "hi" } });
    const { res, json } = await call(body, stdHeaders("tools/call", encoded));
    expect(res.status).toBe(200);
    expect(json.result.content[0].text).toBe("hi");
  });

  it("decodes sentinel values", () => {
    expect(decodeHeaderValue("us-west1")).toBe("us-west1");
    expect(decodeHeaderValue(`=?base64?${Buffer.from("Hello, 世界").toString("base64")}?=`)).toBe("Hello, 世界");
  });
});

describe("version negotiation", () => {
  it("returns UnsupportedProtocolVersionError with the supported list", async () => {
    const { res, json } = await call(rpc("tools/list", {}, "1999-01-01"), stdHeaders("tools/list", undefined, "1999-01-01"));
    expect(res.status).toBe(400);
    expect(json.error.code).toBe(-32022);
    expect(json.error.data.requested).toBe("1999-01-01");
    expect(json.error.data.supported).toContain(V);
  });

  it("rejects removed methods on the current revision", async () => {
    for (const method of ["ping", "initialize", "logging/setLevel", "resources/subscribe"]) {
      const { res, json } = await call(rpc(method), stdHeaders(method));
      expect(res.status).toBe(404);
      expect(json.error.code).toBe(-32601);
    }
  });
});

describe("tools/call", () => {
  it("returns resultType complete and serverInfo", async () => {
    const body = rpc("tools/call", { name: "echo", arguments: { text: "hello" } });
    const { json } = await call(body, stdHeaders("tools/call", "echo"));
    expect(json.result.resultType).toBe("complete");
    expect(json.result.content[0].text).toBe("hello");
  });

  it("reports bad arguments as invalid params", async () => {
    const body = rpc("tools/call", { name: "echo", arguments: {} });
    const { json } = await call(body, stdHeaders("tools/call", "echo"));
    expect(json.error.code).toBe(-32602);
  });
});

describe("legacy compatibility", () => {
  it("still answers initialize without standard headers", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "old", version: "1" } },
    };
    const { res, json } = await call(body, { "mcp-protocol-version": "2025-11-25" });
    expect(res.status).toBe(200);
    expect(json.result.protocolVersion).toBe("2025-11-25");
    expect(json.result.serverInfo.name).toBe("personal-brain");
    // Legacy clients must not see 2026-07-28-only fields.
    expect(json.result.resultType).toBeUndefined();
    expect(json.result.ttlMs).toBeUndefined();
  });

  it("answers ping for legacy clients", async () => {
    const body = { jsonrpc: "2.0", id: 2, method: "ping" };
    const { res } = await call(body, { "mcp-protocol-version": "2025-06-18" });
    expect(res.status).toBe(200);
  });

  it("acks notifications with 202", async () => {
    const body = { jsonrpc: "2.0", method: "notifications/initialized" };
    const { res } = await call(body, { "mcp-protocol-version": "2025-11-25" });
    expect(res.status).toBe(202);
  });
});

describe("subscriptions/listen", () => {
  it("opens an SSE stream that acknowledges the subscription", async () => {
    const req = post(rpc("subscriptions/listen", { notifications: { toolsListChanged: true } }, V, 7), stdHeaders("subscriptions/listen"));
    const res = await handleMcpPost(req, { registry: registry() });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const reader = res.body!.getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value!);
    expect(chunk).toContain("notifications/subscriptions/acknowledged");
    expect(chunk).toContain(META.subscriptionId);
    await reader.cancel();
  });
});

describe("oauth token claims", () => {
  const env = { OAUTH_ISSUER: "https://issuer.example.com", MCP_RESOURCE: "https://mcp.example.com" } as any;
  const future = Math.floor(Date.now() / 1000) + 600;

  it("accepts a token bound to this resource", () => {
    expect(() =>
      assertClaims({ iss: "https://issuer.example.com", aud: "https://mcp.example.com", exp: future }, env),
    ).not.toThrow();
  });

  it("rejects a token minted for another audience", () => {
    expect(() =>
      assertClaims({ iss: "https://issuer.example.com", aud: "https://other.example.com", exp: future }, env),
    ).toThrow(/audience/);
  });

  it("rejects an expired token", () => {
    expect(() =>
      assertClaims({ iss: "https://issuer.example.com", aud: "https://mcp.example.com", exp: 1 }, env),
    ).toThrow(/expired/);
  });

  it("rejects a foreign issuer", () => {
    expect(() =>
      assertClaims({ iss: "https://evil.example.com", aud: "https://mcp.example.com", exp: future }, env),
    ).toThrow(/issuer/);
  });
});

describe("full tool catalog", () => {
  it("registers every tool with a valid JSON Schema and honest annotations", async () => {
    // supabase-js touches WebSocket at construction on Node < 22; the Worker
    // runtime provides it natively.
    (globalThis as any).WebSocket ??= class {} as any;
    const { buildRegistry } = await import("../src/mcp");
    const env = {
      SUPABASE_URL: "https://stub.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "stub",
      OPENAI_API_KEY: "stub",
      MCP_BEARER_TOKEN: "stub",
      INGEST_BEARER_TOKEN: "stub",
    } as any;
    const reg = buildRegistry(env);
    const tools = reg.list();

    expect(tools.length).toBeGreaterThanOrEqual(50);
    // Deterministic ordering for client-side and prompt caching.
    expect(tools.map((t) => t.name)).toEqual([...tools.map((t) => t.name)].sort());

    for (const t of tools) {
      expect(t.description.length, `${t.name} needs a description`).toBeGreaterThan(20);
      expect(t.inputSchema.type, `${t.name} inputSchema`).toBe("object");
      expect(typeof t.annotations.readOnlyHint, `${t.name} annotations`).toBe("boolean");
      // A read-only tool is never also destructive.
      if (t.annotations.readOnlyHint) expect(t.annotations.destructiveHint).toBe(false);
    }
  });
});
