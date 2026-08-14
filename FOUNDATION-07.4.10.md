# Foundation 07.4.10 — Normalizer Handoff

## Architecture

```text
qagent-plugin-v2
  -> qagent-observation (Data Plane)
  -> normalization_outbox
  -> Cloudflare Queue
  -> qagent-normalizer (Processing Plane)
  -> NORMALIZER_DB
  -> normalized_endpoints
  -> future API Catalog
```

## Invariants

1. Observation ingestion remains the synchronous trust boundary.
2. Only already-sanitized data can be emitted to the normalization queue.
3. `qagent-normalizer` has no Observation D1 binding.
4. No ClientKey, `qps_*`, `qog_*` or `qos_*` is present in the handoff contract.
5. Queue delivery is treated as at-least-once; event processing is idempotent by `event_id`.
6. Outbox rows contain identifiers/status only, not raw payload blobs.
7. Schema inference persists structure/types only, never JSON sample values.
8. Dynamic path normalization v1 uses strong deterministic patterns only (numeric IDs, UUID, ObjectId, ULID, long hex).
9. API Catalog remains downstream; `normalized_endpoints` is Processing Plane materialization, not browser authority.
10. Public HTTP routing accepts the Cloudflare Route prefix `/v1/normalizer/*` while keeping direct `/health` compatibility on workers.dev.
