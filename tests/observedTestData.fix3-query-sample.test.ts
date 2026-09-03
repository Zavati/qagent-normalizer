import { describe, expect, it } from "vitest";
import { extractObservedTestData } from "../src/normalization/observedTestData";

describe("07.7.8-C2 FIX-3 Privacy-Safe Observed Query Samples", () => {
  it("uses the separate query sample while safeUrl remains fully redacted", async () => {
    const signal = await extractObservedTestData(
      null,
      null,
      false,
      "https://example.test/leave?includeEmployees=__qagent_redacted__&limit=__qagent_redacted__&offset=__qagent_redacted__",
      "/leave",
      {
        contractVersion: "qagent.observed-query-sample.v1",
        values: { includeEmployees: "true", limit: "50", offset: "0" },
      },
    );

    expect(signal?.encoding).toBe("QUERY");
    expect(signal?.selectors).toEqual([
      { target: "QUERY", selector: "includeEmployees" },
      { target: "QUERY", selector: "limit" },
      { target: "QUERY", selector: "offset" },
    ]);
    expect(signal?.values).toEqual([
      { target: "QUERY", selector: "includeEmployees", valueType: "BOOLEAN", value: true },
      { target: "QUERY", selector: "limit", valueType: "INTEGER", value: 50 },
      { target: "QUERY", selector: "offset", valueType: "INTEGER", value: 0 },
    ]);
    expect(JSON.stringify(signal)).not.toContain("__qagent_redacted__");
  });

  it("keeps the legacy safeUrl fallback for rolling compatibility", async () => {
    const signal = await extractObservedTestData(
      null,
      null,
      false,
      "https://example.test/users?page=2&limit=25",
      "/users",
      null,
    );
    expect(signal?.values).toEqual([
      { target: "QUERY", selector: "limit", valueType: "STRING", value: "25" },
      { target: "QUERY", selector: "page", valueType: "STRING", value: "2" },
    ]);
  });
});
