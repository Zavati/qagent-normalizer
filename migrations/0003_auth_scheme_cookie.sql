-- Foundation 07.7.2-A FIX — widen persisted observed auth scheme to COOKIE.
--
-- Why this is a NEW migration instead of editing 0002:
-- 0002 may already be applied remotely. Historical migrations are immutable.
-- The remote D1 can therefore still have the older CHECK constraint even if
-- the local 0002 file now contains COOKIE.
--
-- SQLite cannot alter a CHECK constraint in place, so rebuild the table while
-- preserving every existing row and recreating its indexes.

CREATE TABLE normalized_endpoint_events__auth_cookie_v2 (
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
  created_at TEXT NOT NULL,
  auth_observed INTEGER CHECK (auth_observed IS NULL OR auth_observed IN (0, 1)),
  auth_scheme TEXT CHECK (
    auth_scheme IS NULL
    OR auth_scheme IN ('BEARER', 'BASIC', 'API_KEY', 'COOKIE', 'UNKNOWN')
  )
);

INSERT INTO normalized_endpoint_events__auth_cookie_v2 (
  event_id, endpoint_id, organization_id, project_id, environment_id,
  observation_session_id, batch_id, method, scheme, host, normalized_path,
  observed_at, status_code, network_failure, origin_relation, latency_ms,
  request_schema_json, response_schema_json, created_at, auth_observed, auth_scheme
)
SELECT
  event_id, endpoint_id, organization_id, project_id, environment_id,
  observation_session_id, batch_id, method, scheme, host, normalized_path,
  observed_at, status_code, network_failure, origin_relation, latency_ms,
  request_schema_json, response_schema_json, created_at, auth_observed, auth_scheme
FROM normalized_endpoint_events;

DROP TABLE normalized_endpoint_events;
ALTER TABLE normalized_endpoint_events__auth_cookie_v2 RENAME TO normalized_endpoint_events;

CREATE INDEX IF NOT EXISTS idx_normalized_endpoint_events_endpoint
  ON normalized_endpoint_events (endpoint_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_normalized_endpoint_events_batch
  ON normalized_endpoint_events (observation_session_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_normalized_endpoint_events_auth_signal
  ON normalized_endpoint_events (organization_id, project_id, auth_observed, auth_scheme, observed_at);
