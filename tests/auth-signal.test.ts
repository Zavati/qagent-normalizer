import { describe, expect, it } from "vitest";
import { buildCatalogUpdateMessage } from "../src/contracts/catalogUpdate";
import type { NormalizedEventInput } from "../src/storage/normalizerRepository";

function baseEvent(): NormalizedEventInput {
  return {
    eventId: "evt_auth_1",
    endpointId: "nep_auth_1",
    organizationId: "org_1",
    projectId: "prj_1",
    environmentId: "env_1",
    observationSessionId: "obs_1",
    batchId: "batch_1",
    method: "GET",
    scheme: "https",
    host: "api.example.com",
    normalizedPath: "/api/myself/settings",
    observedAt: "2026-08-21T14:00:00.000Z",
    statusCode: 200,
    networkFailure: false,
    originRelation: "EXTERNAL",
    latencyMs: 42,
    resourceType: "fetch",
    authObserved: true,
    authScheme: "BEARER",
    requestContentType: null,
    responseContentType: "application/json",
    requestSchema: null,
    responseSchema: { type: "object", properties: { receive_email: { type: "boolean" } } },
    observedTestData: null,
    createdAt: "2026-08-21T14:00:00.100Z",
  };
}

describe("Foundation 07.7.2-A FIX-2 Normalizer auth signal", () => {
  it("keeps the signal coarse and optional in catalog-update-v1", async () => {
    const message = await buildCatalogUpdateMessage(baseEvent());
    expect(message.schemaVersion).toBe("qagent.catalog-update.v1");
    expect(message.observation.authObserved).toBe(true);
    expect(message.observation.authScheme).toBe("BEARER");
  });

  it("omits the optional fields for historical/unknown observations", async () => {
    const event = baseEvent();
    event.authObserved = null;
    event.authScheme = null;
    const message = await buildCatalogUpdateMessage(event);
    expect("authObserved" in message.observation).toBe(false);
    expect("authScheme" in message.observation).toBe(false);
  });
});
