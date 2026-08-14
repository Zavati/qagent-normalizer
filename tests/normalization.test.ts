import { describe, expect, it } from "vitest";
import { normalizeApiUrl } from "../src/normalization/pathNormalizer";
import { inferJsonSchema, mergeSchemas } from "../src/normalization/schemaInference";

describe("Foundation 07.4.10 normalization", () => {
  it("clusters strong dynamic path identifiers without retaining query values", () => {
    expect(normalizeApiUrl("https://api.example.com/users/123/orders/550e8400-e29b-41d4-a716-446655440000?token=[REDACTED]"))
      .toEqual({ scheme: "https", host: "api.example.com", normalizedPath: "/users/{id}/orders/{uuid}" });
  });

  it("infers JSON structure without persisting field values", () => {
    expect(inferJsonSchema("application/json", JSON.stringify({ id: 42, name: "Ana", active: true }), false))
      .toEqual({
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          active: { type: "boolean" },
        },
      });
  });

  it("merges compatible schema observations idempotently", () => {
    const a = inferJsonSchema("application/json", JSON.stringify({ id: 1, tag: "x" }), false);
    const b = inferJsonSchema("application/json", JSON.stringify({ id: null, enabled: true }), false);
    const merged = mergeSchemas(a, b);
    expect(mergeSchemas(merged, b)).toEqual(merged);
    expect(merged?.properties?.id.type).toEqual(["integer", "null"]);
  });
});
