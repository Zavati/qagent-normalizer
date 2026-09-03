export interface HandoffSample {
  contentType: string | null;
  body: string | null;
  truncated: boolean;
}

export interface HandoffObservedQuerySample {
  contractVersion: "qagent.observed-query-sample.v1";
  values: Record<string, string>;
}

export interface HandoffObservation {
  eventId: string;
  observedAt: string;
  method: string;
  safeUrl: string;
  statusCode: number | null;
  latencyMs: number;
  resourceType: string;
  failureCode: string | null;
  authObserved?: boolean;
  authScheme?: "BEARER" | "BASIC" | "API_KEY" | "COOKIE" | "UNKNOWN" | null;
  navigationId: string | null;
  pageUrl: string | null;
  requestQuerySample?: HandoffObservedQuerySample | null;
  requestSample: HandoffSample | null;
  responseSample: HandoffSample | null;
}

export interface NormalizationHandoffMessage {
  schemaVersion: "qagent.normalization.v1";
  handoffId: string;
  partIndex: number;
  partCount: number;
  emittedAt: string;
  context: {
    organizationId: string;
    projectId: string;
    environmentId: string;
    observationSessionId: string;
  };
  batch: {
    batchId: string;
    sequence: number;
  };
  observations: HandoffObservation[];
}
