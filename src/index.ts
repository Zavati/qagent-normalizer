import type { NormalizationHandoffMessage } from "./contracts/handoff";
import { processHandoff } from "./normalization/processor";

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
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: env.SERVICE_NAME, foundation: "07.4.10", role: "processing-plane" });
    }
    return json({ status: "not_found", message: "Endpoint inexistente." }, 404);
  },

  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      try {
        if (!isHandoff(message.body)) {
          console.error("[QAgent Normalizer] invalid handoff", message.id);
          message.ack();
          continue;
        }
        await processHandoff(env.NORMALIZER_DB, message.body);
        message.ack();
      } catch (error) {
        console.error("[QAgent Normalizer] handoff processing failed", message.id, error);
        message.retry({ delaySeconds: 5 });
      }
    }
  },
} satisfies ExportedHandler<Env, unknown, NormalizationHandoffMessage>;
