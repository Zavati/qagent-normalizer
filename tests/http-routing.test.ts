import { describe, expect, it } from "vitest";
import { normalizePublicPathname } from "../src/http/publicPath";

describe("Foundation 07.4.10 public HTTP routing", () => {
  it("keeps the workers.dev health path unchanged", () => {
    expect(normalizePublicPathname("/health")).toBe("/health");
  });

  it("removes the public /v1/normalizer prefix", () => {
    expect(normalizePublicPathname("/v1/normalizer/health")).toBe("/health");
  });

  it("normalizes the public service root", () => {
    expect(normalizePublicPathname("/v1/normalizer")).toBe("/");
    expect(normalizePublicPathname("/v1/normalizer/")).toBe("/");
  });

  it("does not rewrite unrelated paths", () => {
    expect(normalizePublicPathname("/v1/observation/health")).toBe("/v1/observation/health");
  });
});
