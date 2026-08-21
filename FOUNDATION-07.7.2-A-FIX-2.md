# QAgent Normalizer — Foundation 07.7.2-A FIX-2
## Observed Auth Signal Bridge — Processing Plane

Extends the existing additive contracts with optional, derived auth metadata:

```text
authObserved?: boolean
authScheme?: BEARER | BASIC | API_KEY | UNKNOWN | null
```

The Normalizer:

- accepts old `qagent.normalization.v1` messages with no auth fields;
- validates/sanitizes the pair before use;
- persists only coarse metadata in `normalized_endpoint_events`;
- emits optional fields inside `qagent.catalog-update.v1.observation`;
- never receives or emits Authorization/token/cookie/API-key values.

Migration:

```text
0002_observed_auth_signal.sql
```

Deployment order requirement:

1. qagent-catalog must first accept/persist/query the optional fields;
2. then deploy qagent-normalizer;
3. then qagent-observation;
4. then the current collector plugin that derives the signal;
5. Gateway FIX-2 is already compatible.
