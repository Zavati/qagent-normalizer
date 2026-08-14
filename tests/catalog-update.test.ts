import { describe, expect, it } from "vitest";
import { buildCatalogUpdateMessage } from "../src/contracts/catalogUpdate";
import { inferJsonSchema } from "../src/normalization/schemaInference";
import type { NormalizedEventInput } from "../src/storage/normalizerRepository";

function event(): NormalizedEventInput {
  return {
    eventId: "evt_123",
    endpointId: "nep_123",
    organizationId: "org_1",
    projectId: "prj_1",
    environmentId: "env_1",
    observationSessionId: "obs_1",
    batchId: "batch_1",
    method: "POST",
    scheme: "https",
    host: "api.example.com",
    normalizedPath: "/users/{id}",
    observedAt: "2026-08-14T21:00:00.000Z",
    statusCode: 200,
    networkFailure: false,
    originRelation: "SAME_ORIGIN",
    latencyMs: 111,
    resourceType: "fetch",
    requestContentType: "application/json",
    responseContentType: "application/json",
    requestSchema: inferJsonSchema("application/json", JSON.stringify({ password: "super-secret", id: 42 }), false),
    responseSchema: inferJsonSchema("application/json", JSON.stringify({ token: "raw-token", name: "Igor" }), false),
    createdAt: "2026-08-14T21:00:01.000Z",
  };
}

describe("Foundation 07.5.2 Normalizer -> Catalog contract", () => {
  it("builds a deterministic idempotency key from the normalized event", async () => {
    const first = await buildCatalogUpdateMessage(event(), "2026-08-14T21:01:00.000Z");
    const second = await buildCatalogUpdateMessage(event(), "2026-08-14T21:02:00.000Z");
    expect(second.eventId).toBe(first.eventId);
    expect(first.schemaVersion).toBe("qagent.catalog-update.v1");
  });

  it("contains only derived schemas, never sample values or raw URLs", async () => {
    const message = await buildCatalogUpdateMessage(event(), "2026-08-14T21:01:00.000Z");
    const serialized = JSON.stringify(message);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("safeUrl");
    expect(serialized).not.toContain("pageUrl");
    expect(serialized).toContain('"password":{"type":"string"}');
    expect(serialized).toContain('"token":{"type":"string"}');
  });

  it("hashes equivalent schema structures canonically", async () => {
    const a = event();
    const b = event();
    a.requestSchema = { type: "object", properties: { b: { type: "string" }, a: { type: "integer" } } };
    b.requestSchema = { type: "object", properties: { a: { type: "integer" }, b: { type: "string" } } };
    const [ma, mb] = await Promise.all([buildCatalogUpdateMessage(a), buildCatalogUpdateMessage(b)]);
    expect(ma.schemas.request?.hash).toBe(mb.schemas.request?.hash);
  });
});
