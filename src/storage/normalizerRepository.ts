import type { InferredSchema } from "../normalization/schemaInference";
import type { OriginRelation } from "../normalization/originRelation";

export type ObservedAuthScheme = "BEARER" | "BASIC" | "API_KEY" | "COOKIE" | "UNKNOWN";

export interface NormalizedEventInput {
  eventId: string;
  endpointId: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  observationSessionId: string;
  batchId: string;
  method: string;
  scheme: string;
  host: string;
  normalizedPath: string;
  observedAt: string;
  statusCode: number | null;
  networkFailure: boolean;
  originRelation: OriginRelation;
  latencyMs: number;
  resourceType: string;
  authObserved: boolean | null;
  authScheme: ObservedAuthScheme | null;
  requestContentType: string | null;
  responseContentType: string | null;
  requestSchema: InferredSchema | null;
  responseSchema: InferredSchema | null;
  createdAt: string;
}

interface ExistingEndpointRow {
  request_schema_json: string | null;
  response_schema_json: string | null;
}

export interface EndpointAggregate {
  firstSeenAt: string;
  lastSeenAt: string;
  observationCount: number;
  successCount: number;
  redirectCount: number;
  clientErrorCount: number;
  serverErrorCount: number;
  networkFailureCount: number;
  sameOriginCount: number;
  sameSiteCount: number;
  externalCount: number;
  unknownOriginCount: number;
  latencyTotalMs: number;
  latencyMinMs: number;
  latencyMaxMs: number;
}

export async function recordHandoffReceived(
  db: D1Database,
  input: {
    handoffId: string; partIndex: number; partCount: number;
    observationSessionId: string; batchId: string; batchSequence: number;
    organizationId: string; projectId: string; environmentId: string;
    observationCount: number;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO normalization_handoffs (
      handoff_id, part_index, part_count, observation_session_id, batch_id, batch_sequence,
      organization_id, project_id, environment_id, observation_count,
      received_at, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?)
    ON CONFLICT(handoff_id, part_index) DO UPDATE SET
      received_at = excluded.received_at,
      observation_count = excluded.observation_count,
      updated_at = excluded.updated_at
  `).bind(
    input.handoffId, input.partIndex, input.partCount, input.observationSessionId,
    input.batchId, input.batchSequence, input.organizationId, input.projectId,
    input.environmentId, input.observationCount, now, now, now,
  ).run();
}

export async function markHandoffProcessed(db: D1Database, handoffId: string, partIndex: number): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE normalization_handoffs
    SET status = 'PROCESSED', processed_at = ?, last_error = NULL, updated_at = ?
    WHERE handoff_id = ? AND part_index = ?
  `).bind(now, now, handoffId, partIndex).run();
}

export async function markHandoffFailed(db: D1Database, handoffId: string, partIndex: number, error: unknown): Promise<void> {
  const now = new Date().toISOString();
  const message = String(error instanceof Error ? error.message : error).slice(0, 500);
  await db.prepare(`
    UPDATE normalization_handoffs
    SET status = 'FAILED', last_error = ?, updated_at = ?
    WHERE handoff_id = ? AND part_index = ? AND status <> 'PROCESSED'
  `).bind(message, now, handoffId, partIndex).run();
}

export async function insertEndpointEvent(db: D1Database, event: NormalizedEventInput): Promise<void> {
  await db.prepare(`
    INSERT OR IGNORE INTO normalized_endpoint_events (
      event_id, endpoint_id, organization_id, project_id, environment_id,
      observation_session_id, batch_id, method, scheme, host, normalized_path,
      observed_at, status_code, network_failure, origin_relation, latency_ms,
      auth_observed, auth_scheme,
      request_schema_json, response_schema_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    event.eventId, event.endpointId, event.organizationId, event.projectId, event.environmentId,
    event.observationSessionId, event.batchId, event.method, event.scheme, event.host, event.normalizedPath,
    event.observedAt, event.statusCode, event.networkFailure ? 1 : 0, event.originRelation, event.latencyMs,
    event.authObserved === null ? null : (event.authObserved ? 1 : 0), event.authScheme,
    event.requestSchema ? JSON.stringify(event.requestSchema) : null,
    event.responseSchema ? JSON.stringify(event.responseSchema) : null,
    event.createdAt,
  ).run();
}

export async function getEndpointAggregate(db: D1Database, endpointId: string): Promise<EndpointAggregate> {
  const row = await db.prepare(`
    SELECT
      MIN(observed_at) AS first_seen_at,
      MAX(observed_at) AS last_seen_at,
      COUNT(*) AS observation_count,
      SUM(CASE WHEN network_failure = 0 AND status_code BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN network_failure = 0 AND status_code BETWEEN 300 AND 399 THEN 1 ELSE 0 END) AS redirect_count,
      SUM(CASE WHEN network_failure = 0 AND status_code BETWEEN 400 AND 499 THEN 1 ELSE 0 END) AS client_error_count,
      SUM(CASE WHEN network_failure = 0 AND status_code BETWEEN 500 AND 599 THEN 1 ELSE 0 END) AS server_error_count,
      SUM(network_failure) AS network_failure_count,
      SUM(CASE WHEN origin_relation = 'SAME_ORIGIN' THEN 1 ELSE 0 END) AS same_origin_count,
      SUM(CASE WHEN origin_relation = 'SAME_SITE_HEURISTIC' THEN 1 ELSE 0 END) AS same_site_count,
      SUM(CASE WHEN origin_relation = 'EXTERNAL' THEN 1 ELSE 0 END) AS external_count,
      SUM(CASE WHEN origin_relation = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknown_origin_count,
      SUM(latency_ms) AS latency_total_ms,
      MIN(latency_ms) AS latency_min_ms,
      MAX(latency_ms) AS latency_max_ms
    FROM normalized_endpoint_events
    WHERE endpoint_id = ?
  `).bind(endpointId).first<Record<string, string | number | null>>();
  if (!row || !row.first_seen_at || !row.last_seen_at) throw new Error("endpoint aggregate unavailable");
  return {
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    observationCount: Number(row.observation_count ?? 0),
    successCount: Number(row.success_count ?? 0),
    redirectCount: Number(row.redirect_count ?? 0),
    clientErrorCount: Number(row.client_error_count ?? 0),
    serverErrorCount: Number(row.server_error_count ?? 0),
    networkFailureCount: Number(row.network_failure_count ?? 0),
    sameOriginCount: Number(row.same_origin_count ?? 0),
    sameSiteCount: Number(row.same_site_count ?? 0),
    externalCount: Number(row.external_count ?? 0),
    unknownOriginCount: Number(row.unknown_origin_count ?? 0),
    latencyTotalMs: Number(row.latency_total_ms ?? 0),
    latencyMinMs: Number(row.latency_min_ms ?? 0),
    latencyMaxMs: Number(row.latency_max_ms ?? 0),
  };
}

export async function getExistingEndpointSchemas(db: D1Database, endpointId: string): Promise<{
  requestSchema: InferredSchema | null;
  responseSchema: InferredSchema | null;
}> {
  const row = await db.prepare(`
    SELECT request_schema_json, response_schema_json
    FROM normalized_endpoints WHERE endpoint_id = ? LIMIT 1
  `).bind(endpointId).first<ExistingEndpointRow>();
  const parse = (value: string | null | undefined): InferredSchema | null => {
    if (!value) return null;
    try { return JSON.parse(value) as InferredSchema; } catch { return null; }
  };
  return { requestSchema: parse(row?.request_schema_json), responseSchema: parse(row?.response_schema_json) };
}

export async function upsertNormalizedEndpoint(
  db: D1Database,
  event: NormalizedEventInput,
  aggregate: EndpointAggregate,
  requestSchema: InferredSchema | null,
  responseSchema: InferredSchema | null,
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO normalized_endpoints (
      endpoint_id, organization_id, project_id, environment_id, method, scheme, host, normalized_path,
      first_seen_at, last_seen_at, observation_count, success_count, redirect_count,
      client_error_count, server_error_count, network_failure_count,
      same_origin_count, same_site_count, external_count, unknown_origin_count,
      latency_total_ms, latency_min_ms, latency_max_ms,
      request_schema_json, response_schema_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint_id) DO UPDATE SET
      first_seen_at = excluded.first_seen_at,
      last_seen_at = excluded.last_seen_at,
      observation_count = excluded.observation_count,
      success_count = excluded.success_count,
      redirect_count = excluded.redirect_count,
      client_error_count = excluded.client_error_count,
      server_error_count = excluded.server_error_count,
      network_failure_count = excluded.network_failure_count,
      same_origin_count = excluded.same_origin_count,
      same_site_count = excluded.same_site_count,
      external_count = excluded.external_count,
      unknown_origin_count = excluded.unknown_origin_count,
      latency_total_ms = excluded.latency_total_ms,
      latency_min_ms = excluded.latency_min_ms,
      latency_max_ms = excluded.latency_max_ms,
      request_schema_json = excluded.request_schema_json,
      response_schema_json = excluded.response_schema_json,
      updated_at = excluded.updated_at
  `).bind(
    event.endpointId, event.organizationId, event.projectId, event.environmentId,
    event.method, event.scheme, event.host, event.normalizedPath,
    aggregate.firstSeenAt, aggregate.lastSeenAt, aggregate.observationCount, aggregate.successCount,
    aggregate.redirectCount, aggregate.clientErrorCount, aggregate.serverErrorCount,
    aggregate.networkFailureCount, aggregate.sameOriginCount, aggregate.sameSiteCount, aggregate.externalCount, aggregate.unknownOriginCount,
    aggregate.latencyTotalMs, aggregate.latencyMinMs, aggregate.latencyMaxMs,
    requestSchema ? JSON.stringify(requestSchema) : null,
    responseSchema ? JSON.stringify(responseSchema) : null,
    now, now,
  ).run();
}
