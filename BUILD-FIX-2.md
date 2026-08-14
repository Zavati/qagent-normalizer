# Build Fix 2 — Cloudflare Queue return type

## Build error

```text
TS2322: Type 'Promise<QueueSendResponse>' is not assignable to type 'Promise<void>'.
```

## Cause

The Catalog publisher boundary intentionally exposes `send(...): Promise<void>`.
With the current Cloudflare Worker runtime types, `Queue.send()` returns
`Promise<QueueSendResponse>`. Returning the Cloudflare promise directly from the
adapter therefore violated the transport-neutral publisher interface.

## Fix

The Worker adapter now awaits the Cloudflare send operation and does not return
the provider-specific response:

```ts
send: async (catalogEvent) => {
  await env.CATALOG_UPDATE_QUEUE.send(catalogEvent);
},
```

This keeps the Processing Plane contract independent from Cloudflare-specific
return types while preserving send failure propagation.

## Unchanged

- `qagent.catalog-update.v1` contract
- Queue name and binding
- D1 schema and migrations
- idempotency rules
- Normalizer aggregation
- Catalog ingestion behavior
