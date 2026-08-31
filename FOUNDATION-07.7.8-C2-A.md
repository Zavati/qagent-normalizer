# Foundation 07.7.8-C2-A — Safe Observed Test Data Extraction

## Goal

Preserve bounded, sanitized request values already observed by QAgent so later Test Data planning can reuse valid runtime data with minimal QA configuration.

## Boundary

The Browser Sensor / Observation contract is unchanged. Observation remains the privacy/redaction boundary and the Normalizer receives only the sanitized `requestSample` already present in the handoff.

C2-A adds a derived optional signal to `qagent.catalog-update.v1`:

```text
observedTestData.contractVersion = qagent.observed-test-data.v1
```

The signal contains only scalar BODY candidates plus a deterministic sample fingerprint. It never includes the raw request body.

## Supported in v1

- `application/json`
- `application/*+json`
- `application/x-www-form-urlencoded`
- nested JSON object selectors using simple `$.field.child` paths
- STRING / INTEGER / NUMBER / BOOLEAN / NULL values

Arrays are intentionally deferred until the Test Data selector/runtime contract supports explicit array selectors.

## Safety

- truncated samples are rejected;
- secret/auth selector names are denied again in the Normalizer;
- redaction/truncation markers are never promoted;
- strings are capped at 256 UTF-8 bytes;
- at most 48 values are emitted per observed request;
- selector depth and size are bounded;
- sample fingerprints are deterministic and contain no secret material beyond the already-sanitized candidates.

## Compatibility

No Normalizer D1 migration is required. Existing endpoint/schema aggregation remains unchanged. `observedTestData` is additive and optional in `qagent.catalog-update.v1`.
