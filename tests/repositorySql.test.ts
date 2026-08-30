import { describe, expect, it } from "vitest";
import {
  insertEndpointEvent,
  recordHandoffReceived,
  upsertNormalizedEndpoint,
  type EndpointAggregate,
  type NormalizedEventInput,
} from "../src/storage/normalizerRepository";

class StatementProbe {
  constructor(readonly sql: string) {}

  bind(...values: unknown[]) {
    const placeholders = (this.sql.match(/\?/g) ?? []).length;
    if (placeholders !== values.length) {
      throw new Error(`SQL bind mismatch: ${placeholders} placeholders for ${values.length} values`);
    }
    return this;
  }

  async run() {
    return { meta: { changes: 1 } };
  }

  async first<T>() {
    return null as T | null;
  }
}

function dbProbe(): D1Database {
  return {
    prepare(sql: string) {
      return new StatementProbe(sql);
    },
  } as unknown as D1Database;
}

const event: NormalizedEventInput = {
  eventId: "evt_1",
  endpointId: "nep_1",
  organizationId: "org_1",
  projectId: "prj_1",
  environmentId: "env_1",
  observationSessionId: "obs_1",
  batchId: "batch_1",
  method: "GET",
  scheme: "https",
  host: "api.example.com",
  normalizedPath: "/users/{id}",
  observedAt: "2026-08-14T18:00:00.000Z",
  statusCode: 200,
  networkFailure: false,
  originRelation: "SAME_ORIGIN",
  latencyMs: 42,
  authObserved: null,
  authScheme: null,
  requestContentType: null,
  responseContentType: "application/json",
  requestSchema: null,
  responseSchema: { type: "object", properties: { id: { type: "integer" } } },
  createdAt: "2026-08-14T18:00:00.000Z",
};

const aggregate: EndpointAggregate = {
  firstSeenAt: event.observedAt,
  lastSeenAt: event.observedAt,
  observationCount: 1,
  successCount: 1,
  redirectCount: 0,
  clientErrorCount: 0,
  serverErrorCount: 0,
  networkFailureCount: 0,
  sameOriginCount: 1,
  sameSiteCount: 0,
  externalCount: 0,
  unknownOriginCount: 0,
  latencyTotalMs: 42,
  latencyMinMs: 42,
  latencyMaxMs: 42,
};

describe("Foundation 07.4.10 repository SQL bindings", () => {
  it("matches handoff INSERT placeholders to bound values", async () => {
    await expect(recordHandoffReceived(dbProbe(), {
      handoffId: "nhf_1",
      partIndex: 1,
      partCount: 1,
      observationSessionId: "obs_1",
      batchId: "batch_1",
      batchSequence: 1,
      organizationId: "org_1",
      projectId: "prj_1",
      environmentId: "env_1",
      observationCount: 1,
    })).resolves.toBeUndefined();
  });

  it("matches normalized event INSERT placeholders to bound values", async () => {
    await expect(insertEndpointEvent(dbProbe(), event)).resolves.toBeUndefined();
  });

  it("rejects invalid negative latency before D1 can silently ignore the row", async () => {
    await expect(insertEndpointEvent(dbProbe(), { ...event, latencyMs: -1 }))
      .rejects.toMatchObject({ name: "NormalizerInvariantError", code: "NORMALIZER_EVENT_LATENCY_INVALID" });
  });

  it("matches normalized endpoint UPSERT placeholders to bound values", async () => {
    await expect(upsertNormalizedEndpoint(dbProbe(), event, aggregate, null, event.responseSchema)).resolves.toBeUndefined();
  });
});
