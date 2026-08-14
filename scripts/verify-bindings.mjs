import { readFileSync } from "node:fs";

const configPath = new URL("../wrangler.toml", import.meta.url);
const config = readFileSync(configPath, "utf8");

const requiredFragments = [
  '[[queues.producers]]',
  'binding = "CATALOG_UPDATE_QUEUE"',
  'queue = "qagent-catalog-updates-dev"',
];

const missing = requiredFragments.filter((fragment) => !config.includes(fragment));

if (missing.length > 0) {
  console.error("[QAgent Normalizer] Required Catalog Queue producer binding is missing from wrangler.toml.");
  console.error("Expected:");
  console.error('[[queues.producers]]');
  console.error('binding = "CATALOG_UPDATE_QUEUE"');
  console.error('queue = "qagent-catalog-updates-dev"');
  console.error("Preserve only the real NORMALIZER_DB database_id when replacing snapshots; do not preserve an older wrangler.toml.");
  process.exit(1);
}

console.log("[QAgent Normalizer] Catalog Queue producer binding verified.");
