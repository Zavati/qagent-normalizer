import type { HandoffObservation, NormalizationHandoffMessage } from "../contracts/handoff";
import { normalizeApiUrl } from "./pathNormalizer";
import { inferJsonSchema, mergeSchemas } from "./schemaInference";
import { classifyOriginRelation } from "./originRelation";
import { extractObservedTestData } from "./observedTestData";
import { buildCatalogUpdateMessage, type CatalogUpdateMessageV1 } from "../contracts/catalogUpdate";
import {
  getEndpointAggregate,
  getExistingEndpointSchemas,
  insertEndpointEvent,
  markHandoffFailed,
  markHandoffProcessed,
  recordHandoffReceived,
  upsertNormalizedEndpoint,
  type NormalizedEventInput,
} from "../storage/normalizerRepository";

const API_RESOURCE_TYPES = new Set(["fetch", "xhr", "xmlhttprequest", "websocket", "eventsource"]);

function normalizeContentType(value: string | null | undefined): string | null {
  if (!value) return null;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType ? mediaType.slice(0, 128) : null;
}

function isApiCandidate(observation: HandoffObservation): boolean {
  const resourceType = observation.resourceType.toLowerCase();
  if (API_RESOURCE_TYPES.has(resourceType)) return true;
  const requestType = observation.requestSample?.contentType?.toLowerCase() ?? "";
  const responseType = observation.responseSample?.contentType?.toLowerCase() ?? "";
  return requestType.includes("json") || responseType.includes("json");
}


function normalizeObservedAuthSignal(observation: HandoffObservation): {
  authObserved: boolean | null;
  authScheme: "BEARER" | "BASIC" | "API_KEY" | "COOKIE" | "UNKNOWN" | null;
} {
  if (observation.authObserved === undefined && observation.authScheme === undefined) {
    return { authObserved: null, authScheme: null };
  }

  if (typeof observation.authObserved !== "boolean") {
    return { authObserved: null, authScheme: null };
  }

  if (!observation.authObserved) {
    return observation.authScheme === undefined || observation.authScheme === null
      ? { authObserved: false, authScheme: null }
      : { authObserved: null, authScheme: null };
  }

  const scheme = observation.authScheme;
  if (scheme === "BEARER" || scheme === "BASIC" || scheme === "API_KEY" || scheme === "COOKIE" || scheme === "UNKNOWN") {
    return { authObserved: true, authScheme: scheme };
  }

  return { authObserved: null, authScheme: null };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function endpointIdFor(message: NormalizationHandoffMessage, observation: HandoffObservation, scheme: string, host: string, path: string): Promise<string> {
  const key = [message.context.organizationId, message.context.projectId, message.context.environmentId, observation.method, scheme, host, path].join("|");
  return `nep_${(await sha256Hex(key)).slice(0, 40)}`;
}

async function normalizeEvent(message: NormalizationHandoffMessage, observation: HandoffObservation): Promise<NormalizedEventInput | null> {
  const url = normalizeApiUrl(observation.safeUrl);
  if (!url) return null;
  const endpointId = await endpointIdFor(message, observation, url.scheme, url.host, url.normalizedPath);
  const authSignal = normalizeObservedAuthSignal(observation);
  return {
    eventId: observation.eventId,
    endpointId,
    organizationId: message.context.organizationId,
    projectId: message.context.projectId,
    environmentId: message.context.environmentId,
    observationSessionId: message.context.observationSessionId,
    batchId: message.batch.batchId,
    method: observation.method.trim().toUpperCase(),
    scheme: url.scheme,
    host: url.host,
    normalizedPath: url.normalizedPath,
    observedAt: observation.observedAt,
    statusCode: observation.statusCode,
    networkFailure: observation.failureCode !== null,
    originRelation: classifyOriginRelation(observation.pageUrl, observation.safeUrl),
    latencyMs: observation.latencyMs,
    resourceType: observation.resourceType.trim().toLowerCase() || "unknown",
    authObserved: authSignal.authObserved,
    authScheme: authSignal.authScheme,
    requestContentType: normalizeContentType(observation.requestSample?.contentType),
    responseContentType: normalizeContentType(observation.responseSample?.contentType),
    requestSchema: inferJsonSchema(observation.requestSample?.contentType ?? null, observation.requestSample?.body ?? null, observation.requestSample?.truncated ?? false),
    responseSchema: inferJsonSchema(observation.responseSample?.contentType ?? null, observation.responseSample?.body ?? null, observation.responseSample?.truncated ?? false),
    observedTestData: await extractObservedTestData(
      observation.requestSample?.contentType ?? null,
      observation.requestSample?.body ?? null,
      observation.requestSample?.truncated ?? false,
      observation.safeUrl,
    ),
    createdAt: new Date().toISOString(),
  };
}

async function applyEvent(db: D1Database, event: NormalizedEventInput): Promise<void> {
  await insertEndpointEvent(db, event);
  const [aggregate, existing] = await Promise.all([
    getEndpointAggregate(db, event.endpointId),
    getExistingEndpointSchemas(db, event.endpointId),
  ]);
  const requestSchema = mergeSchemas(existing.requestSchema, event.requestSchema);
  const responseSchema = mergeSchemas(existing.responseSchema, event.responseSchema);
  await upsertNormalizedEndpoint(db, event, aggregate, requestSchema, responseSchema);
}

export interface CatalogUpdatePublisher {
  send(message: CatalogUpdateMessageV1): Promise<void>;
}

export async function processHandoff(
  db: D1Database,
  message: NormalizationHandoffMessage,
  catalogPublisher: CatalogUpdatePublisher,
): Promise<void> {
  await recordHandoffReceived(db, {
    handoffId: message.handoffId,
    partIndex: message.partIndex,
    partCount: message.partCount,
    observationSessionId: message.context.observationSessionId,
    batchId: message.batch.batchId,
    batchSequence: message.batch.sequence,
    organizationId: message.context.organizationId,
    projectId: message.context.projectId,
    environmentId: message.context.environmentId,
    observationCount: message.observations.length,
  });

  try {
    for (const observation of message.observations) {
      if (!isApiCandidate(observation)) continue;
      const event = await normalizeEvent(message, observation);
      if (event) {
        await applyEvent(db, event);
        await catalogPublisher.send(await buildCatalogUpdateMessage(event));
      }
    }
    await markHandoffProcessed(db, message.handoffId, message.partIndex);
  } catch (error) {
    await markHandoffFailed(db, message.handoffId, message.partIndex, error);
    throw error;
  }
}
