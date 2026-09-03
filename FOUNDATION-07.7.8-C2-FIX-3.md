# QAgent 07.7.8-C2 FIX-3 — Privacy-Safe Observed Query Samples

## Objective

Preserve reusable, non-sensitive query literals for the Observed Test Data Reservoir without weakening the existing `safeUrl` privacy boundary.

## Invariants

- `safeUrl` remains fully redacted: query parameter names may survive, query literals do not.
- Secrets and sensitive literals are never replaced with fake values for Test Data; unsafe fields are omitted from the query sample.
- The browser performs the first sanitization pass and `qagent-observation` repeats validation/sanitization at the trust boundary.
- The optional handoff field is backward compatible with `qagent.normalization.v1`.
- Catalog, Gateway, Registry, Runner, Results and Console require no changes for this FIX.

## Flow

```text
Browser original request URL
  -> Plugin extracts bounded privacy-safe requestQuery sample
  -> Plugin separately creates fully-redacted safeUrl
  -> Observation re-sanitizes requestQuery
  -> Observation persists request_query_sample_json in network_samples
  -> Normalizer handoff carries requestQuerySample
  -> Normalizer creates typed QUERY Observed Test Data candidates
  -> existing Catalog Reservoir materializes values/samples
  -> existing Gateway Observed-First planner can select OBSERVED
```

## Supported query literal typing

The browser/Observation contract transports URL query values as strings. The Normalizer safely promotes canonical literals when unambiguous:

- `true` / `false` -> BOOLEAN
- canonical safe integers such as `0`, `25`, `-1` -> INTEGER
- canonical decimal numbers such as `12.5` -> NUMBER
- values such as `001`, dates, ids and arbitrary text remain STRING

This preserves lexical identifiers while allowing parameters such as `includeEmployees`, `limit` and `offset` to retain useful runtime types.

## Security

Hard-denied names (authorization/cookie/token/password/api key/session/csrf/etc.) are omitted. Values detected by the existing sensitive-string engine (credentials, QAgent tokens, JWT-like material, email, CPF, phone and related patterns) are omitted. Redaction/truncation placeholders are never persisted as Observed Test Data values.

## Deployment order

1. Apply Observation D1 migration `0011_observed_query_samples.sql`.
2. Deploy `qagent-observation`.
3. Deploy `qagent-normalizer`.
4. Reload/install `qagent-plugin-v2` 2.0.12.

Old Plugins continue to work (shape-only / generated fallback). New Plugin payloads must not be sent to an old Observation build because older strict sample validation does not know `requestQuery`.
