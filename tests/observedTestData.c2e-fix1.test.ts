import { describe, expect, it } from "vitest";
import { extractObservedTestData } from "../src/normalization/observedTestData";

describe("07.7.8-C2-E FIX-1 Query Shape / Value Decoupling", () => {
  it("preserves redacted QUERY selectors without storing redacted values", async () => {
    const signal = await extractObservedTestData(
      null,
      null,
      false,
      "https://example.test/holidays?fromDate=%5BREDACTED%5D&toDate=%5BREDACTED%5D",
    );

    expect(signal).not.toBeNull();
    expect(signal?.encoding).toBe("QUERY");
    expect(signal?.selectors).toEqual([
      { target: "QUERY", selector: "fromDate" },
      { target: "QUERY", selector: "toDate" },
    ]);
    expect(signal?.values).toEqual([]);
    expect(signal?.sampleFingerprint).toMatch(/^otds_[a-f0-9]{40}$/);
  });

  it("preserves QUERY shape and existing safe QUERY values", async () => {
    const signal = await extractObservedTestData(
      null,
      null,
      false,
      "https://example.test/users?page=2&limit=25",
    );

    expect(signal?.selectors).toEqual([
      { target: "QUERY", selector: "limit" },
      { target: "QUERY", selector: "page" },
    ]);

    expect(signal?.values).toEqual([
      {
        target: "QUERY",
        selector: "limit",
        valueType: "STRING",
        value: "25",
      },
      {
        target: "QUERY",
        selector: "page",
        valueType: "STRING",
        value: "2",
      },
    ]);
  });

  it("does not promote denied query names into shape or values", async () => {
    const signal = await extractObservedTestData(
      null,
      null,
      false,
      "https://example.test/users?access_token=%5BREDACTED%5D",
    );

    expect(signal).toBeNull();
  });

  it("keeps repeated query keys as shape but not as scalar observed values", async () => {
    const signal = await extractObservedTestData(
      null,
      null,
      false,
      "https://example.test/search?tag=a&tag=b",
    );

    expect(signal?.selectors).toEqual([
      { target: "QUERY", selector: "tag" },
    ]);
    expect(signal?.values).toEqual([]);
  });

  it("captures QUERY shape even when request body is truncated", async () => {
    const signal = await extractObservedTestData(
      "application/json",
      '{"ignored":"because truncated"}',
      true,
      "https://example.test/holidays?fromDate=%5BREDACTED%5D&toDate=%5BREDACTED%5D",
    );

    expect(signal?.encoding).toBe("QUERY");
    expect(signal?.selectors).toEqual([
      { target: "QUERY", selector: "fromDate" },
      { target: "QUERY", selector: "toDate" },
    ]);
    expect(signal?.values).toEqual([]);
  });

  it("preserves existing BODY-only behavior without adding selectors", async () => {
    const signal = await extractObservedTestData(
      "application/json",
      JSON.stringify({
        firstName: "Ada",
        lastName: "Lovelace",
      }),
      false,
      "https://example.test/employees",
    );

    expect(signal?.encoding).toBe("JSON");
    expect(signal?.selectors).toBeUndefined();
    expect(signal?.values).toEqual([
      {
        target: "BODY",
        selector: "$.firstName",
        valueType: "STRING",
        value: "Ada",
      },
      {
        target: "BODY",
        selector: "$.lastName",
        valueType: "STRING",
        value: "Lovelace",
      },
    ]);
  });
});
