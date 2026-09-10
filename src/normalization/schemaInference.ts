/** 08.1.6. Inference describes evidence, never redaction sentinels as domain types. */
export const INFERENCE_VERSION = "qagent.structural-inference.v2";
export type InferredSchema = {
  type: string | string[];
  properties?: Record<string, InferredSchema>;
  items?: InferredSchema;
  format?: string;
  "x-qagent-partial"?: boolean;
  "x-qagent-coverage-reasons"?: string[];
  "x-qagent-inference-version"?: string;
  "x-qagent-observed-required"?: string[];
};
const MAX_DEPTH = 6, MAX_PROPERTIES = 64, MAX_ARRAY_ITEMS = 20;
const MARKER = /\[REDACTED\]|\[TRUNCATED\]|__qagent_(?:redacted|truncated)__/i;
function partial(schema: InferredSchema, ...reasons: string[]): InferredSchema {
  schema["x-qagent-partial"] = true;
  schema["x-qagent-coverage-reasons"] = [...new Set([...(schema["x-qagent-coverage-reasons"] || []), ...reasons])].sort();
  return schema;
}
export function validObservedDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const n = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value;
}
function scalar(value: unknown): InferredSchema {
  if (value === null) return {type:"null"};
  if (typeof value === "boolean") return {type:"boolean"};
  if (typeof value === "number" && Number.isFinite(value)) return {type:Number.isInteger(value)?"integer":"number"};
  if (typeof value === "string") {
    if (MARKER.test(value)) return partial({type:"unknown"}, "SANITIZED_VALUE");
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return {type:"string",format:"uuid"};
    if (validObservedDate(value)) return {type:"string",format:"date"};
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && validObservedDate(value.slice(0,10)) && Number.isFinite(Date.parse(value))) return {type:"string",format:"date-time"};
    return {type:"string"};
  }
  return partial({type:"unknown"}, "UNSUPPORTED_VALUE");
}
const types = (s: InferredSchema) => Array.isArray(s.type) ? s.type : [s.type];
export function mergeSchemas(a: InferredSchema | null, b: InferredSchema | null): InferredSchema | null {
  if (!a) return b ? structuredClone(b) : null;
  if (!b) return structuredClone(a);
  const union = [...new Set([...types(a),...types(b)])].sort();
  const out: InferredSchema = {type:union.length === 1 ? union[0]! : union};
  if (a.format && a.format === b.format) out.format = a.format;
  if (a["x-qagent-partial"] || b["x-qagent-partial"]) partial(out, ...(a["x-qagent-coverage-reasons"]||[]), ...(b["x-qagent-coverage-reasons"]||[]));
  if (union.includes("object")) {
    const allKeys = [...new Set([...Object.keys(a.properties||{}), ...Object.keys(b.properties||{})])].sort();
    const props: Record<string,InferredSchema> = Object.create(null);
    for (const key of allKeys.slice(0, MAX_PROPERTIES)) {
      const child = mergeSchemas(a.properties?.[key] || null,b.properties?.[key] || null);
      if (child) props[key] = child;
    }
    if (allKeys.length) out.properties = props;
    const ar = a["x-qagent-observed-required"] || [], br = b["x-qagent-observed-required"] || [];
    out["x-qagent-observed-required"] = types(a).includes("object") && types(b).includes("object")
      ? ar.filter(k => br.includes(k)) : (types(a).includes("object") ? ar : br);
    if (allKeys.length > MAX_PROPERTIES) partial(out,"PROPERTY_LIMIT");
  }
  if (union.includes("array")) {const child = mergeSchemas(a.items||null,b.items||null); if(child) out.items = child;}
  return out;
}
function infer(value: unknown, depth: number): InferredSchema {
  // Scalars at the boundary remain typed; structural truncation is not an expected type.
  if (value === null || typeof value !== "object") return scalar(value);
  if (depth >= MAX_DEPTH) return partial({type:"unknown"},"DEPTH_LIMIT");
  if (Array.isArray(value)) {
    let items: InferredSchema|null = null;
    for (const x of value.slice(0,MAX_ARRAY_ITEMS)) items = mergeSchemas(items,infer(x,depth+1));
    const out: InferredSchema = {type:"array", ...(items?{items}:{})};
    if (value.length > MAX_ARRAY_ITEMS) partial(out,"ARRAY_SAMPLE_LIMIT");
    return out;
  }
  const record = value as Record<string,unknown>;
  if (Object.prototype.hasOwnProperty.call(record,"_qagent") && typeof record._qagent === "string" && MARKER.test(record._qagent)) return partial({type:"unknown"},"SANITIZED_CONTAINER");
  const entries = Object.entries(record).sort(([a],[b])=>a.localeCompare(b));
  const props: Record<string,InferredSchema> = Object.create(null);
  for (const [key,x] of entries.slice(0,MAX_PROPERTIES)) {
    // Never use special prototype names as executable property metadata.
    if (["__proto__","constructor","prototype"].includes(key)) continue;
    props[key] = infer(x,depth+1);
  }
  const out: InferredSchema = {type:"object", ...(Object.keys(props).length?{properties:props}:{}), "x-qagent-observed-required":Object.keys(props).sort()};
  if (entries.length > MAX_PROPERTIES) partial(out,"PROPERTY_LIMIT");
  if (entries.some(([k])=>["__proto__","constructor","prototype"].includes(k))) partial(out,"UNSUPPORTED_PROPERTY");
  return out;
}
export function schemaCoverageReasons(schema: InferredSchema|null): string[] {
  const reasons = new Set<string>();
  function visit(s: InferredSchema|null|undefined): void {
    if (!s) return;
    if (types(s).includes("unknown")) reasons.add("UNKNOWN_STRUCTURE");
    if (s["x-qagent-partial"]) reasons.add("PARTIAL_CAPTURE");
    for(const x of s["x-qagent-coverage-reasons"]||[]) reasons.add(x);
    for(const x of Object.values(s.properties||{})) visit(x);
    visit(s.items);
  }
  visit(schema); return [...reasons].sort();
}
export function inferJsonSchema(contentType: string|null, body: string|null, truncated: boolean): InferredSchema|null {
  if (!body || !contentType?.toLowerCase().includes("json")) return null;
  try {
    const schema = infer(JSON.parse(body),0);
    if (truncated) partial(schema,"BODY_TRUNCATED");
    schema["x-qagent-inference-version"] = INFERENCE_VERSION;
    return schema;
  } catch { return null; }
}
