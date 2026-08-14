# Catalog Handoff — Foundation 07.5.2

The Normalizer now emits a versioned derived event after local deterministic normalization.

```text
qagent-normalization-dev
  -> qagent-normalizer
  -> CATALOG_UPDATE_QUEUE
  -> qagent-catalog-updates-dev
  -> qagent-catalog
```

Contract version: `qagent.catalog-update.v1`.

## Safety boundary

The event contains normalized endpoint coordinates, operational signals and inferred structural schemas only. It never carries request/response body samples, raw URLs, page URLs, query values or browser/control-plane credentials.

## Retry semantics

The derived Normalizer event is persisted before the Catalog update is sent. The source normalization Queue message is acknowledged only after Catalog publication and final handoff state update. If publication or finalization fails, the source message retries. Catalog `eventId` is deterministic, so duplicates are expected and safe.

## Deployment

The Normalizer requires this producer binding:

```toml
[[queues.producers]]
binding = "CATALOG_UPDATE_QUEUE"
queue = "qagent-catalog-updates-dev"
```

Create and deploy the Catalog consumer first, then deploy this Normalizer snapshot.

## Build fix 1 — configuration preservation rule

When applying this snapshot, preserve **only** the real `NORMALIZER_DB.database_id` from the deployed environment. Do not preserve an older `wrangler.toml`, because this revision requires the `CATALOG_UPDATE_QUEUE` producer binding.
