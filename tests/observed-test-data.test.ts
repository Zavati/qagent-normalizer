import { describe, expect, it } from "vitest";
import { extractObservedTestData } from "../src/normalization/observedTestData";

describe("Foundation 07.7.8-C2-A Observed Test Data extraction", () => {
  it("extracts bounded scalar leaves from sanitized JSON while preserving nesting", async () => {
    const signal = await extractObservedTestData(
      "application/json",
      JSON.stringify({ empNumber: 7, leaveTypeId: 3, duration: { type: "full_day" }, comment: "QA" }),
      false,
    );
    expect(signal?.encoding).toBe("JSON");
    expect(signal?.sampleFingerprint).toMatch(/^otds_[0-9a-f]{40}$/);
    expect(signal?.values).toEqual([
      { target: "BODY", selector: "$.comment", valueType: "STRING", value: "QA" },
      { target: "BODY", selector: "$.duration.type", valueType: "STRING", value: "full_day" },
      { target: "BODY", selector: "$.empNumber", valueType: "INTEGER", value: 7 },
      { target: "BODY", selector: "$.leaveTypeId", valueType: "INTEGER", value: 3 },
    ]);
  });

  it("never promotes redacted or secret selectors into observed test data", async () => {
    const signal = await extractObservedTestData(
      "application/json",
      JSON.stringify({ username: "Admin", password: "[REDACTED]", accessToken: "[REDACTED]", safeId: 9 }),
      false,
    );
    const serialized = JSON.stringify(signal);
    expect(serialized).toContain("$.username");
    expect(serialized).toContain("$.safeId");
    expect(serialized).not.toContain("$.password");
    expect(serialized).not.toContain("$.accessToken");
    expect(serialized).not.toContain("[REDACTED]");
  });

  it("supports sanitized form-urlencoded requests without persisting credential fields", async () => {
    const signal = await extractObservedTestData(
      "application/x-www-form-urlencoded",
      "grant_type=password&username=Admin&password=%5BREDACTED%5D",
      false,
    );
    expect(signal?.encoding).toBe("FORM_URLENCODED");
    expect(signal?.values).toEqual([
      { target: "BODY", selector: "$.grant_type", valueType: "STRING", value: "password" },
      { target: "BODY", selector: "$.username", valueType: "STRING", value: "Admin" },
    ]);
  });

  it("fails closed for truncated samples and defers array selectors", async () => {
    expect(await extractObservedTestData("application/json", JSON.stringify({ id: 1 }), true)).toBeNull();
    const signal = await extractObservedTestData("application/json", JSON.stringify({ id: 1, items: [{ id: 2 }] }), false);
    expect(signal?.values).toEqual([{ target: "BODY", selector: "$.id", valueType: "INTEGER", value: 1 }]);
  });

  it("fingerprints equivalent field order deterministically", async () => {
    const a = await extractObservedTestData("application/json", JSON.stringify({ b: 2, a: 1 }), false);
    const b = await extractObservedTestData("application/json", JSON.stringify({ a: 1, b: 2 }), false);
    expect(a?.sampleFingerprint).toBe(b?.sampleFingerprint);
  });
});
