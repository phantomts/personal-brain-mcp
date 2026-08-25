/**
 * Tool registry.
 *
 * Tools keep the same authoring shape they have always had:
 *
 *   export function register(server, ctx) {
 *     server.tool(name, description, zodShape, handler);
 *   }
 *
 * `ToolRegistry` implements that `tool()` surface, so every existing tool file
 * registers unchanged. What the registry adds is the 2026-07-28 metadata the
 * wire needs: JSON Schema input/output schemas, tool annotations, and a
 * deterministic listing order for client-side and prompt caching.
 */
import { z, type ZodRawShape, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { annotationsFor, type ToolAnnotations } from "./annotations";
import { invalidParams } from "./jsonrpc";

export interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface ToolResult {
  content: ContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

export type ToolHandler = (args: any, extra?: unknown) => Promise<ToolResult> | ToolResult;

export interface JsonSchemaObject {
  $schema?: string;
  type: "object";
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchemaObject;
  outputSchema?: Record<string, unknown>;
  annotations: ToolAnnotations;
  /** `x-mcp-header` mirrors declared in the input schema, precomputed. */
  headerParams: Array<{ header: string; path: string[] }>;
  validate: (args: unknown) => unknown;
  handler: ToolHandler;
}

export interface ToolConfig<S extends ZodRawShape = ZodRawShape> {
  title?: string;
  description?: string;
  inputSchema?: S;
  outputSchema?: ZodTypeAny | Record<string, unknown>;
  annotations?: ToolAnnotations;
}

/** Arguments a handler receives, inferred from its zod input shape. */
export type InferArgs<S extends ZodRawShape> = z.infer<z.ZodObject<S>>;

export type TypedHandler<S extends ZodRawShape> = (
  args: InferArgs<S>,
  extra?: unknown,
) => Promise<ToolResult> | ToolResult;

/**
 * The registration surface handed to tool modules. Named `ToolRegistrar` and
 * imported by tools under the alias `McpServer` so existing files read the
 * same as before. Handler argument types are inferred from the zod shape,
 * exactly as they were under the SDK's `McpServer.tool()`.
 */
export interface ToolRegistrar {
  tool<S extends ZodRawShape>(name: string, description: string, shape: S, handler: TypedHandler<S>): void;
  tool<S extends ZodRawShape>(name: string, config: { inputSchema: S } & ToolConfig<S>, handler: TypedHandler<S>): void;
  tool(name: string, description: string, handler: TypedHandler<Record<string, never>>): void;
  registerTool<S extends ZodRawShape>(
    name: string,
    config: { inputSchema?: S } & ToolConfig<S>,
    handler: TypedHandler<S>,
  ): void;
}

export class ToolRegistry implements ToolRegistrar {
  private readonly tools = new Map<string, ToolDefinition>();

  /**
   * Accepts every historical call shape:
   *   tool(name, description, shape, handler)
   *   tool(name, description, handler)
   *   tool(name, shape, handler)
   *   tool(name, config, handler)
   */
  tool<S extends ZodRawShape>(name: string, description: string, shape: S, handler: TypedHandler<S>): void;
  tool<S extends ZodRawShape>(name: string, config: { inputSchema: S } & ToolConfig<S>, handler: TypedHandler<S>): void;
  tool<S extends ZodRawShape>(name: string, shape: S, handler: TypedHandler<S>): void;
  tool(name: string, description: string, handler: TypedHandler<Record<string, never>>): void;
  tool(name: string, ...rest: any[]): void {
    const handler = rest[rest.length - 1] as ToolHandler;
    let description = "";
    let shape: ZodRawShape | undefined;
    let config: ToolConfig = {};

    for (const arg of rest.slice(0, -1)) {
      if (typeof arg === "string") description = arg;
      else if (isZodShape(arg)) shape = arg as ZodRawShape;
      else if (arg && typeof arg === "object") config = arg as ToolConfig;
    }

    this.registerTool(
      name,
      {
        ...config,
        description: config.description ?? description,
        inputSchema: config.inputSchema ?? shape,
      },
      handler,
    );
  }

  registerTool(name: string, config: ToolConfig<any>, handler: ToolHandler): void {
    if (this.tools.has(name)) throw new Error(`duplicate tool registration: ${name}`);
    const shape = (config.inputSchema ?? {}) as ZodRawShape;
    const zodObject = z.object(shape);
    const inputSchema = toJsonSchema(zodObject) as JsonSchemaObject;
    inputSchema.type = "object";

    this.tools.set(name, {
      name,
      title: config.title,
      description: config.description ?? "",
      inputSchema,
      outputSchema: config.outputSchema ? normalizeOutputSchema(config.outputSchema) : undefined,
      annotations: { ...annotationsFor(name, config.title), ...config.annotations },
      headerParams: collectHeaderParams(inputSchema),
      validate: (args: unknown) => {
        const parsed = zodObject.safeParse(args ?? {});
        if (!parsed.success) {
          throw invalidParams(
            `Invalid arguments for ${name}: ${parsed.error.issues
              .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
              .join("; ")}`,
          );
        }
        return parsed.data;
      },
      handler,
    });
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Deterministic order (name ascending). The spec asks for stable ordering so
   * clients can cache `tools/list` and keep LLM prompt-cache hits.
   */
  list(): ToolDefinition[] {
    return [...this.tools.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  get size(): number {
    return this.tools.size;
  }
}

function isZodShape(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const values = Object.values(value as Record<string, unknown>);
  if (values.length === 0) return false;
  return values.every((v) => typeof v === "object" && v !== null && "_def" in (v as object));
}

function toJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  return zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
}

function normalizeOutputSchema(schema: ZodTypeAny | Record<string, unknown>): Record<string, unknown> {
  if (schema && typeof schema === "object" && "_def" in (schema as object)) {
    return toJsonSchema(schema as ZodTypeAny);
  }
  return schema as Record<string, unknown>;
}

/**
 * Walk the input schema for `x-mcp-header` annotations. Only properties
 * reachable through a chain of `properties` keys are valid per spec, so that
 * is the only path we follow.
 */
function collectHeaderParams(schema: JsonSchemaObject): Array<{ header: string; path: string[] }> {
  const out: Array<{ header: string; path: string[] }> = [];
  const walk = (node: unknown, path: string[]) => {
    if (!node || typeof node !== "object") return;
    const props = (node as Record<string, unknown>).properties as Record<string, unknown> | undefined;
    if (!props) return;
    for (const [key, child] of Object.entries(props)) {
      if (!child || typeof child !== "object") continue;
      const header = (child as Record<string, unknown>)["x-mcp-header"];
      if (typeof header === "string" && header.length > 0) {
        out.push({ header, path: [...path, key] });
      }
      walk(child, [...path, key]);
    }
  };
  walk(schema, []);
  return out;
}
