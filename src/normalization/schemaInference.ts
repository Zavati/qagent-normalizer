export type InferredSchema = {
  type: string | string[];
  properties?: Record<string, InferredSchema>;
  items?: InferredSchema;
  format?: string;
  "x-qagent-partial"?: boolean;
};

const MAX_DEPTH = 6;
const MAX_PROPERTIES = 64;
const MAX_ARRAY_ITEMS = 20;

function scalarSchema(value: unknown): InferredSchema {
  if (value === null) return { type: "null" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "string") {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      return { type: "string", format: "uuid" };
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return { type: "string", format: "date-time" };
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { type: "string", format: "date" };
    return { type: "string" };
  }
  return { type: "unknown" };
}

function typeList(type: string | string[]): string[] {
  return Array.isArray(type) ? type : [type];
}

export function mergeSchemas(a: InferredSchema | null, b: InferredSchema | null): InferredSchema | null {
  if (!a) return b ? structuredClone(b) : null;
  if (!b) return structuredClone(a);

  const types = [...new Set([...typeList(a.type), ...typeList(b.type)])].sort();
  const merged: InferredSchema = { type: types.length === 1 ? types[0] : types };
  if (a.format && a.format === b.format) merged.format = a.format;
  if (a["x-qagent-partial"] || b["x-qagent-partial"]) merged["x-qagent-partial"] = true;

  if (types.includes("object")) {
    const props: Record<string, InferredSchema> = {};
    const keys = [...new Set([
      ...Object.keys(a.properties ?? {}),
      ...Object.keys(b.properties ?? {}),
    ])].sort().slice(0, MAX_PROPERTIES);
    for (const key of keys) {
      const child = mergeSchemas(a.properties?.[key] ?? null, b.properties?.[key] ?? null);
      if (child) props[key] = child;
    }
    if (Object.keys(props).length) merged.properties = props;
  }

  if (types.includes("array")) {
    const items = mergeSchemas(a.items ?? null, b.items ?? null);
    if (items) merged.items = items;
  }
  return merged;
}

function infer(value: unknown, depth: number): InferredSchema {
  if (depth >= MAX_DEPTH) return { type: "unknown", "x-qagent-partial": true };
  if (Array.isArray(value)) {
    let items: InferredSchema | null = null;
    for (const item of value.slice(0, MAX_ARRAY_ITEMS)) items = mergeSchemas(items, infer(item, depth + 1));
    const schema: InferredSchema = { type: "array" };
    if (items) schema.items = items;
    if (value.length > MAX_ARRAY_ITEMS) schema["x-qagent-partial"] = true;
    return schema;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const schema: InferredSchema = { type: "object", properties: {} };
    for (const [key, child] of entries.slice(0, MAX_PROPERTIES)) {
      schema.properties![key] = infer(child, depth + 1);
    }
    if (entries.length > MAX_PROPERTIES) schema["x-qagent-partial"] = true;
    if (Object.keys(schema.properties!).length === 0) delete schema.properties;
    return schema;
  }
  return scalarSchema(value);
}

export function inferJsonSchema(contentType: string | null, body: string | null, truncated: boolean): InferredSchema | null {
  if (!body || !contentType?.toLowerCase().includes("json")) return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    const schema = infer(parsed, 0);
    if (truncated) schema["x-qagent-partial"] = true;
    return schema;
  } catch {
    return null;
  }
}
