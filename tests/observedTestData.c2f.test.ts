import {
  describe,
  expect,
  it,
} from "vitest";

import {
  extractObservedTestData,
} from "../src/normalization/observedTestData";

import {
  normalizeApiUrl,
} from "../src/normalization/pathNormalizer";

describe(
  "07.7.8-C2-F observed PATH_PARAM resolution",
  () => {
    it("extracts a single numeric id with positional metadata", async () => {
      const safeUrl =
        "https://example.test/web/index.php/api/v2/pim/employees/17";

      const normalized =
        normalizeApiUrl(safeUrl);

      expect(normalized?.normalizedPath).toBe(
        "/web/index.php/api/v2/pim/employees/{id}",
      );

      const signal =
        await extractObservedTestData(
          null,
          null,
          false,
          safeUrl,
          normalized!.normalizedPath,
        );

      expect(signal?.encoding).toBe("PATH");

      expect(signal?.values).toEqual([
        {
          target: "PATH_PARAM",
          selector: "id",
          valueType: "STRING",
          value: "17",
          segmentIndex: 6,
          occurrence: 0,
        },
      ]);
    });

    it("preserves repeated id placeholders by position and occurrence", async () => {
      const safeUrl =
        "https://example.test/companies/10/employees/25";

      const normalized =
        normalizeApiUrl(safeUrl);

      expect(normalized?.normalizedPath).toBe(
        "/companies/{id}/employees/{id}",
      );

      const signal =
        await extractObservedTestData(
          null,
          null,
          false,
          safeUrl,
          normalized!.normalizedPath,
        );

      expect(signal?.values).toEqual([
        {
          target: "PATH_PARAM",
          selector: "id",
          valueType: "STRING",
          value: "10",
          segmentIndex: 1,
          occurrence: 0,
        },
        {
          target: "PATH_PARAM",
          selector: "id",
          valueType: "STRING",
          value: "25",
          segmentIndex: 3,
          occurrence: 1,
        },
      ]);
    });

    it("keeps distinct placeholder kinds correlated in the same sample", async () => {
      const safeUrl =
        "https://example.test/users/550e8400-e29b-41d4-a716-446655440000/orders/123";

      const normalized =
        normalizeApiUrl(safeUrl);

      expect(normalized?.normalizedPath).toBe(
        "/users/{uuid}/orders/{id}",
      );

      const signal =
        await extractObservedTestData(
          null,
          null,
          false,
          safeUrl,
          normalized!.normalizedPath,
        );

      expect(signal?.values).toEqual([
        {
          target: "PATH_PARAM",
          selector: "uuid",
          valueType: "STRING",
          value: "550e8400-e29b-41d4-a716-446655440000",
          segmentIndex: 1,
          occurrence: 0,
        },
        {
          target: "PATH_PARAM",
          selector: "id",
          valueType: "STRING",
          value: "123",
          segmentIndex: 3,
          occurrence: 0,
        },
      ]);
    });

    it("does not reuse generic long-hex normalized as id", async () => {
      const tokenLike =
        "abcdef0123456789abcdef0123456789";

      const safeUrl =
        `https://example.test/reset/${tokenLike}`;

      const normalized =
        normalizeApiUrl(safeUrl);

      expect(normalized?.normalizedPath).toBe(
        "/reset/{id}",
      );

      const signal =
        await extractObservedTestData(
          null,
          null,
          false,
          safeUrl,
          normalized!.normalizedPath,
        );

      expect(signal).toBeNull();
    });

    it("fails closed when observed and normalized path structures diverge", async () => {
      const signal =
        await extractObservedTestData(
          null,
          null,
          false,
          "https://example.test/companies/10/employees/25",
          "/companies/{id}/employees",
        );

      expect(signal).toBeNull();
    });

    it("coexists with query shape and query values", async () => {
      const safeUrl =
        "https://example.test/employees/17?fromDate=2026-09-01";

      const normalized =
        normalizeApiUrl(safeUrl);

      const signal =
        await extractObservedTestData(
          null,
          null,
          false,
          safeUrl,
          normalized!.normalizedPath,
        );

      expect(signal?.encoding).toBe("QUERY");

      expect(signal?.selectors).toEqual([
        {
          target: "QUERY",
          selector: "fromDate",
        },
      ]);

      expect(signal?.values).toEqual([
        {
          target: "PATH_PARAM",
          selector: "id",
          valueType: "STRING",
          value: "17",
          segmentIndex: 1,
          occurrence: 0,
        },
        {
          target: "QUERY",
          selector: "fromDate",
          valueType: "STRING",
          value: "2026-09-01",
        },
      ]);
    });
  },
);
