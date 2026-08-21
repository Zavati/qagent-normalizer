import type { InferredSchema } from "../normalization/schemaInference";
import type { OriginRelation } from "../normalization/originRelation";
import type { NormalizedEventInput } from "../storage/normalizerRepository";

export const CATALOG_UPDATE_SCHEMA_VERSION = "qagent.catalog-update.v1" as const;

export interface CatalogSchemaSignal {
  hash: string;
  schema: InferredSchema;
}

export interface CatalogUpdateMessageV1 {
  schemaVersion: typeof CATALOG_UPDATE_SCHEMA_VERSION;
  eventId: string;
  emittedAt: string;
  context: {
    organizationId: string;
    projectId: string;
    environmentId: string;
  };
  source: {
    normalizedEventId: string;
    normalizedEndpointId: string;
    observationSessionId: string;
    batchId: string;
  };
  endpoint: {
    method: string;
    scheme: string;
    host: string;
    normalizedPath: string;
  };
  observation: {
    observedAt: string;
    statusCode: number | null;
    networkFailure: boolean;
    originRelation: OriginRelation;
    latencyMs: number;
    resourceType: string;
    authObserved?: boolean;
    authScheme?: "BEARER" | "BASIC" | "API_KEY" | "COOKIE" | "UNKNOWN" | null;
    requestContentType: string | null;
    responseContentType: string | null;
  };
  schemas: {
    request: CatalogSchemaSignal | null;
    response: CatalogSchemaSignal | null;
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function schemaSignal(schema: InferredSchema | null): Promise<CatalogSchemaSignal | null> {
  if (!schema) return null;
  const canonical = JSON.stringify(canonicalize(schema));
  return {
    hash: `sch_${(await sha256Hex(canonical)).slice(0, 40)}`,
    schema,
  };
}

export async function buildCatalogUpdateMessage(
  event: NormalizedEventInput,
  emittedAt = new Date().toISOString(),
): Promise<CatalogUpdateMessageV1> {
  const eventIdentity = [CATALOG_UPDATE_SCHEMA_VERSION, event.organizationId, event.projectId, event.environmentId, event.eventId].join("|");
  const eventId = `cat_evt_${(await sha256Hex(eventIdentity)).slice(0, 40)}`;
  const [request, response] = await Promise.all([
    schemaSignal(event.requestSchema),
    schemaSignal(event.responseSchema),
  ]);

  return {
    schemaVersion: CATALOG_UPDATE_SCHEMA_VERSION,
    eventId,
    emittedAt,
    context: {
      organizationId: event.organizationId,
      projectId: event.projectId,
      environmentId: event.environmentId,
    },
    source: {
      normalizedEventId: event.eventId,
      normalizedEndpointId: event.endpointId,
      observationSessionId: event.observationSessionId,
      batchId: event.batchId,
    },
    endpoint: {
      method: event.method,
      scheme: event.scheme,
      host: event.host,
      normalizedPath: event.normalizedPath,
    },
    observation: {
      observedAt: event.observedAt,
      statusCode: event.statusCode,
      networkFailure: event.networkFailure,
      originRelation: event.originRelation,
      latencyMs: event.latencyMs,
      resourceType: event.resourceType,
      ...(event.authObserved === null ? {} : {
        authObserved: event.authObserved,
        authScheme: event.authScheme,
      }),
      requestContentType: event.requestContentType,
      responseContentType: event.responseContentType,
    },
    schemas: { request, response },
  };
}
