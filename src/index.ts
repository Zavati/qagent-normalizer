import type { NormalizationHandoffMessage } from "./contracts/handoff";
import { processHandoff } from "./normalization/processor";
import { normalizePublicPathname } from "./http/publicPath";

const NORMALIZER_REVISION =
  "foundation-07.7.8-C2-E-FIX-1";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isHandoff(value: unknown): value is NormalizationHandoffMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Partial<NormalizationHandoffMessage>;
  return input.schemaVersion === "qagent.normalization.v1"
    && typeof input.handoffId === "string"
    && typeof input.partIndex === "number"
    && typeof input.partCount === "number"
    && !!input.context
    && !!input.batch
    && Array.isArray(input.observations);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = normalizePublicPathname(url.pathname);

    if (request.method === "GET" && pathname === "/health") {
      return json({
        status: "ok",
        service: env.SERVICE_NAME,
        foundation: "07.4.10",
        revision: NORMALIZER_REVISION,
        role: "processing-plane",
      });
    }
    return json({ status: "not_found", message: "Endpoint inexistente." }, 404);
  },

  async queue(batch, env): Promise<void> {
    console.log(
      `[QAgent Normalizer] revision=${NORMALIZER_REVISION} messages=${batch.messages.length}`,
    );
    for (const message of batch.messages) {
      try {
        if (!isHandoff(message.body)) {
          console.error("[QAgent Normalizer] invalid handoff", message.id);
          message.ack();
          continue;
        }
        await processHandoff(env.NORMALIZER_DB, message.body, {
          send: async (catalogEvent) => {
            await env.CATALOG_UPDATE_QUEUE.send(catalogEvent);
          },
        });
        message.ack();
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code ?? "NORMALIZER_UNKNOWN_ERROR")
          : "NORMALIZER_UNKNOWN_ERROR";
        console.error("[QAgent Normalizer] handoff processing failed", message.id, code, error);
        message.retry({ delaySeconds: 5 });
      }
    }
  },
} satisfies ExportedHandler<Env, unknown, NormalizationHandoffMessage>;
