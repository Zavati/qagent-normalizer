# QAgent Normalizer — endpoint aggregate unavailable fix

## Root cause in the current repository

`normalized_endpoint_events` used `INSERT OR IGNORE`. In SQLite/D1, `OR IGNORE` can suppress CHECK/NOT NULL constraint failures. The next query then sees no row for the derived endpoint and throws the secondary, misleading error `endpoint aggregate unavailable`.

## Fix

- Replace broad `INSERT OR IGNORE` with `INSERT ... ON CONFLICT(event_id) DO NOTHING`.
- Preserve at-least-once idempotency only for the intended event-id conflict.
- Let all other D1 constraint errors surface instead of being swallowed.
- Detect impossible event-ID collisions explicitly instead of falling through to an empty endpoint aggregate.
- Validate storage invariants for event ID, endpoint ID, observed timestamp and non-negative finite latency before D1.
- Log a bounded safe error code in the Queue consumer.
- No migration. No Catalog/Observation/Runner contract change. No payload/value logging.

## Expected diagnostic after deploy

If the current failing traffic contains an invalid latency, the tail will now show `NORMALIZER_EVENT_LATENCY_INVALID` instead of `endpoint aggregate unavailable`. If a different D1 constraint is the cause, D1 will expose that real constraint failure.
