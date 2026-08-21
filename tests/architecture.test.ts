import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Foundation 07.4.10 Processing Plane architecture", () => {
  it("owns a separate D1 and consumes through Queue + DLQ", () => {
    const wrangler = read("wrangler.toml");
    expect(wrangler).toContain('binding = "NORMALIZER_DB"');
    expect(wrangler).toContain('queue = "qagent-normalization-dev"');
    expect(wrangler).toContain('dead_letter_queue = "qagent-normalization-dlq-dev"');
    expect(wrangler).toContain("max_concurrency = 1");
    expect(wrangler).not.toContain("OBSERVATION_DB");
  });

  it("never introduces browser/control-plane credential fields in the contract", () => {
    const contract = read("src/contracts/handoff.ts");
    expect(contract).not.toContain("clientKey");
    expect(contract).not.toContain("qps_");
    expect(contract).not.toContain("qog_");
    expect(contract).not.toContain("qos_");
  });

  it("allows only coarse derived authentication metadata, never credential values", () => {
    const handoff = read("src/contracts/handoff.ts");
    const catalogUpdate = read("src/contracts/catalogUpdate.ts");
    expect(handoff).toContain("authObserved?: boolean");
    expect(catalogUpdate).toContain("authObserved?: boolean");
    expect(handoff.toLowerCase()).not.toContain("authorization:");
    expect(catalogUpdate.toLowerCase()).not.toContain("authorization:");
    expect(catalogUpdate).not.toContain("accessToken");
  });

});
