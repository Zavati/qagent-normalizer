# qagent-normalizer

QAgent asynchronous Processing Plane introduced in Foundation 07.4.10.
teste


## Responsibility

Consumes sanitized Observation handoffs from Cloudflare Queues and derives bounded, idempotent API endpoint knowledge:

- URL/path normalization
- strong dynamic identifier detection
- endpoint clustering
- JSON request/response schema inference (structure only; no values)
- endpoint occurrence/status/latency aggregation
- at-least-once-safe processing by `event_id`

It does **not** authenticate browser clients, receive `qps_*`/`qog_*`/`qos_*`, or read `OBSERVATION_DB`.

## Development infrastructure

Create these resources before the first deploy:

```bash
npx wrangler queues create qagent-normalization-dev
npx wrangler queues create qagent-normalization-dlq-dev
npx wrangler d1 create qagent-normalizer-dev
```

Paste the returned D1 `database_id` into `wrangler.toml`, then:

```bash
npx wrangler d1 migrations apply qagent-normalizer-dev --remote
npx wrangler deploy
```

Health:

```text
GET /health
```
