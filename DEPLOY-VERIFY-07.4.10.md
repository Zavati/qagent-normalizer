# QAgent Normalizer 07.4.10 — SQL Fix 2

This artifact includes the corrected SQL bindings for `normalized_endpoint_events` (19/19) and `normalized_endpoints` (27/27).

After deploy, verify:

```text
GET /v1/normalizer/health
```

Expected response includes:

```json
{
  "foundation": "07.4.10",
  "revision": "sql-fix-2"
}
```

Queue invocations also log `revision=sql-fix-2`.
