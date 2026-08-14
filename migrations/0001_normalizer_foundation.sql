CREATE TABLE IF NOT EXISTS normalization_handoffs (
  handoff_id TEXT NOT NULL,
  part_index INTEGER NOT NULL CHECK (part_index >= 1),
  part_count INTEGER NOT NULL CHECK (part_count >= 1),
  observation_session_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  batch_sequence INTEGER NOT NULL CHECK (batch_sequence >= 1),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 0 CHECK (observation_count >= 0),
  received_at TEXT NOT NULL,
  processed_at TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (status IN ('RECEIVED', 'PROCESSED', 'FAILED')),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (handoff_id, part_index)
);

CREATE TABLE IF NOT EXISTS normalized_endpoint_events (
  event_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  observation_session_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  method TEXT NOT NULL,
  scheme TEXT NOT NULL,
  host TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  status_code INTEGER,
  network_failure INTEGER NOT NULL DEFAULT 0 CHECK (network_failure IN (0, 1)),
  origin_relation TEXT NOT NULL CHECK (origin_relation IN ('SAME_ORIGIN', 'SAME_SITE_HEURISTIC', 'EXTERNAL', 'UNKNOWN')),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  request_schema_json TEXT,
  response_schema_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS normalized_endpoints (
  endpoint_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  method TEXT NOT NULL,
  scheme TEXT NOT NULL,
  host TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  redirect_count INTEGER NOT NULL DEFAULT 0,
  client_error_count INTEGER NOT NULL DEFAULT 0,
  server_error_count INTEGER NOT NULL DEFAULT 0,
  network_failure_count INTEGER NOT NULL DEFAULT 0,
  same_origin_count INTEGER NOT NULL DEFAULT 0,
  same_site_count INTEGER NOT NULL DEFAULT 0,
  external_count INTEGER NOT NULL DEFAULT 0,
  unknown_origin_count INTEGER NOT NULL DEFAULT 0,
  latency_total_ms INTEGER NOT NULL DEFAULT 0,
  latency_min_ms INTEGER NOT NULL DEFAULT 0,
  latency_max_ms INTEGER NOT NULL DEFAULT 0,
  request_schema_json TEXT,
  response_schema_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, project_id, environment_id, method, scheme, host, normalized_path)
);

CREATE INDEX IF NOT EXISTS idx_normalized_endpoint_events_endpoint
  ON normalized_endpoint_events (endpoint_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_normalized_endpoint_events_batch
  ON normalized_endpoint_events (observation_session_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_normalized_endpoints_project
  ON normalized_endpoints (organization_id, project_id, environment_id, method, normalized_path);
CREATE INDEX IF NOT EXISTS idx_normalized_endpoints_last_seen
  ON normalized_endpoints (project_id, environment_id, last_seen_at);
