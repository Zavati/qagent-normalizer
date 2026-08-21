ALTER TABLE normalized_endpoint_events
  ADD COLUMN auth_observed INTEGER
    CHECK (auth_observed IS NULL OR auth_observed IN (0, 1));

ALTER TABLE normalized_endpoint_events
  ADD COLUMN auth_scheme TEXT
    CHECK (
      auth_scheme IS NULL
      OR auth_scheme IN ('BEARER', 'BASIC', 'API_KEY', 'UNKNOWN')
    );

CREATE INDEX IF NOT EXISTS idx_normalized_endpoint_events_auth_signal
  ON normalized_endpoint_events (organization_id, project_id, auth_observed, auth_scheme, observed_at);
