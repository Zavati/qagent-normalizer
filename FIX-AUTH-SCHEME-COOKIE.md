# QAgent Normalizer — FIX auth_scheme COOKIE D1 drift

## Root cause

The runtime contract and Normalizer code accept:

`BEARER | BASIC | API_KEY | COOKIE | UNKNOWN`

but the already-applied remote D1 schema still has the older CHECK constraint:

`BEARER | BASIC | API_KEY | UNKNOWN`

Requests classified as `COOKIE` therefore fail before aggregation with
`SQLITE_CONSTRAINT_CHECK`.

The local `0002_observed_auth_signal.sql` already contains `COOKIE`, which means
that migration was changed after it had been applied remotely. D1 will not
re-run an already recorded migration. The correct repair is a new immutable
migration.

## Fix

- add `migrations/0003_auth_scheme_cookie.sql`;
- rebuild only `normalized_endpoint_events` to widen the CHECK constraint;
- preserve all rows;
- recreate the three table indexes;
- no contract relaxation and no secret values are stored;
- worker revision: `sql-fix-4-auth-cookie-schema`.

## Deploy

```bash
npm ci
npm run check
npx wrangler d1 migrations list qagent-normalizer-dev --remote
npx wrangler d1 migrations apply qagent-normalizer-dev --remote
npm run deploy
```

## Verify schema

```bash
npx wrangler d1 execute qagent-normalizer-dev --remote --command \
"SELECT sql FROM sqlite_master WHERE type='table' AND name='normalized_endpoint_events';"
```

The returned CHECK must include `COOKIE`.

## Queue note

Messages that have not exhausted `max_retries=5` should succeed on their next
retry after the migration. Messages already moved to `qagent-normalization-dlq-dev`
will not automatically return to the main queue and must be inspected/replayed
using the project's normal DLQ recovery process.
