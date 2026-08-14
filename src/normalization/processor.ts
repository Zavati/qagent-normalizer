import type { HandoffObservation, NormalizationHandoffMessage } from "../contracts/handoff";
import { normalizeApiUrl } from "./pathNormalizer";
import { inferJsonSchema, mergeSchemas } from "./schemaInference";
import { classifyOriginRelation } from "./originRelation";
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

function isApiCandidate(observation: HandoffObservation): boolean {
  const resourceType = observation.resourceType.toLowerCase();
  if (API_RESOURCE_TYPES.has(resourceType)) return true;
  const requestType = observation.requestSample?.contentType?.toLowerCase() ?? "";
  const responseType = observation.responseSample?.contentType?.toLowerCase() ?? "";
  return requestType.includes("json") || responseType.includes("json");
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
  return {
    eventId: observation.eventId,
    endpointId,
    organizationId: message.context.organizationId,
    projectId: message.context.projectId,
    environmentId: message.context.environmentId,
    observationSessionId: message.context.observationSessionId,
    batchId: message.batch.batchId,
    method: observation.method,
    scheme: url.scheme,
    host: url.host,
    normalizedPath: url.normalizedPath,
    observedAt: observation.observedAt,
    statusCode: observation.statusCode,
    networkFailure: observation.failureCode !== null,
    originRelation: classifyOriginRelation(observation.pageUrl, observation.safeUrl),
    latencyMs: observation.latencyMs,
    requestSchema: inferJsonSchema(observation.requestSample?.contentType ?? null, observation.requestSample?.body ?? null, observation.requestSample?.truncated ?? false),
    responseSchema: inferJsonSchema(observation.responseSample?.contentType ?? null, observation.responseSample?.body ?? null, observation.responseSample?.truncated ?? false),
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

export async function processHandoff(db: D1Database, message: NormalizationHandoffMessage): Promise<void> {
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
      if (event) await applyEvent(db, event);
    }
    await markHandoffProcessed(db, message.handoffId, message.partIndex);
  } catch (error) {
    await markHandoffFailed(db, message.handoffId, message.partIndex, error);
    throw error;
  }
}
