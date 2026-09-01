export const OBSERVED_TEST_DATA_CONTRACT_VERSION =
  "qagent.observed-test-data.v1" as const;

export type ObservedTestDataEncoding =
  | "JSON"
  | "FORM_URLENCODED"
  | "QUERY";

export type ObservedTestDataTarget =
  | "BODY"
  | "QUERY";

export type ObservedTestDataValueType =
  | "STRING"
  | "INTEGER"
  | "NUMBER"
  | "BOOLEAN"
  | "NULL";

export interface ObservedTestDataCandidate {
  target: ObservedTestDataTarget;
  selector: string;
  valueType: ObservedTestDataValueType;
  value: string | number | boolean | null;
}

export interface ObservedTestDataSignal {
  contractVersion: typeof OBSERVED_TEST_DATA_CONTRACT_VERSION;
  encoding: ObservedTestDataEncoding;
  sampleFingerprint: string;
  values: ObservedTestDataCandidate[];
}

const MAX_DEPTH = 6;
const MAX_VALUES = 48;
const MAX_STRING_BYTES = 256;
const MAX_SELECTOR_BYTES = 256;

const SAFE_BODY_PROPERTY =
  /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

/*
 * QUERY utiliza o mesmo selector contract adotado
 * no Gateway para C2-E.
 *
 * Exemplos:
 *
 * fromDate
 * toDate
 * page
 * filter.status
 * sort-order
 */
const SAFE_QUERY_PROPERTY =
  /^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/;

const FORBIDDEN_MARKERS = [
  "[REDACTED]",
  "[TRUNCATED]",
  "__qagent_redacted__",
  "__qagent_truncated__",
];

const HARD_DENIED_FIELD_NAMES = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "xapikey",
  "apikey",
  "xauthtoken",
  "password",
  "passwd",
  "pwd",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "clientsecret",
  "clientkey",
  "secret",
  "secretkey",
  "privatekey",
  "sessiontoken",
  "sessionid",
  "sid",
  "token",
  "authtoken",
  "bearertoken",
  "jwt",
  "credential",
  "credentials",
  "csrftoken",
  "xcsrftoken",
  "xsrftoken",
  "otp",
  "pin",
  "cvv",
  "awssecretaccesskey",
  "privatekeydata",
]);

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizedKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isDeniedKey(key: string): boolean {
  return (
    HARD_DENIED_FIELD_NAMES.has(
      normalizedKey(key),
    )
    || key
      .toLowerCase()
      .startsWith("redacted_field_")
  );
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    !!value
    && typeof value === "object"
    && !Array.isArray(value)
  );
}

function isForbiddenString(
  value: string,
): boolean {
  return FORBIDDEN_MARKERS.some(
    (marker) =>
      value.includes(marker),
  );
}

function candidateFor(
  target: ObservedTestDataTarget,
  selector: string,
  value: unknown,
): ObservedTestDataCandidate | null {
  if (
    utf8Bytes(selector)
    > MAX_SELECTOR_BYTES
  ) {
    return null;
  }

  if (value === null) {
    return {
      target,
      selector,
      valueType: "NULL",
      value: null,
    };
  }

  if (
    typeof value === "boolean"
  ) {
    return {
      target,
      selector,
      valueType: "BOOLEAN",
      value,
    };
  }

  if (
    typeof value === "number"
  ) {
    if (!Number.isFinite(value)) {
      return null;
    }

    return {
      target,
      selector,
      valueType:
        Number.isSafeInteger(value)
          ? "INTEGER"
          : "NUMBER",
      value,
    };
  }

  if (
    typeof value === "string"
  ) {
    if (
      utf8Bytes(value)
        > MAX_STRING_BYTES
      || isForbiddenString(value)
    ) {
      return null;
    }

    return {
      target,
      selector,
      valueType: "STRING",
      value,
    };
  }

  return null;
}

function extractJsonValues(
  body: string,
): ObservedTestDataCandidate[] {
  let parsed: unknown;

  try {
    parsed =
      JSON.parse(body) as unknown;
  } catch {
    return [];
  }

  if (!isPlainObject(parsed)) {
    return [];
  }

  const values:
    ObservedTestDataCandidate[] = [];

  const walk = (
    node: Record<string, unknown>,
    prefix: string,
    depth: number,
  ): void => {
    if (
      depth > MAX_DEPTH
      || values.length >= MAX_VALUES
    ) {
      return;
    }

    for (
      const [key, child]
      of Object.entries(node)
    ) {
      if (
        values.length >= MAX_VALUES
      ) {
        break;
      }

      if (
        !SAFE_BODY_PROPERTY.test(key)
        || isDeniedKey(key)
      ) {
        continue;
      }

      const selector =
        `${prefix}.${key}`;

      if (
        isPlainObject(child)
      ) {
        walk(
          child,
          selector,
          depth + 1,
        );

        continue;
      }

      /*
       * Arrays continuam deliberadamente fora
       * do contrato até existir selector DSL
       * explícito para collection/wildcard.
       */
      if (
        Array.isArray(child)
      ) {
        continue;
      }

      const candidate =
        candidateFor(
          "BODY",
          selector,
          child,
        );

      if (candidate) {
        values.push(candidate);
      }
    }
  };

  walk(
    parsed,
    "$",
    0,
  );

  return values;
}

function extractFormValues(
  body: string,
): ObservedTestDataCandidate[] {
  const params =
    new URLSearchParams(body);

  const values:
    ObservedTestDataCandidate[] = [];

  const seen =
    new Set<string>();

  for (
    const key
    of params.keys()
  ) {
    if (
      values.length >= MAX_VALUES
    ) {
      break;
    }

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    if (
      !SAFE_BODY_PROPERTY.test(key)
      || isDeniedKey(key)
    ) {
      continue;
    }

    const all =
      params.getAll(key);

    const distinct =
      [...new Set(all)];

    /*
     * Repeated form keys continuam dependendo
     * de collection selector contract.
     */
    if (
      distinct.length !== 1
    ) {
      continue;
    }

    const candidate =
      candidateFor(
        "BODY",
        `$.${key}`,
        distinct[0],
      );

    if (candidate) {
      values.push(candidate);
    }
  }

  return values;
}

/*
 * 07.7.8-C2-E — Observed Query Values
 *
 * A fonte é a safeUrl já entregue pelo Handoff.
 *
 * Não armazenamos a URL.
 * Não produzimos identidade de endpoint a partir
 * da query.
 *
 * Apenas projetamos pares seguros:
 *
 * QUERY/fromDate = "2026-08-01"
 * QUERY/toDate   = "2026-08-31"
 *
 * Valores redigidos ou secretos são descartados.
 */
function extractQueryValues(
  safeUrl: string | null | undefined,
): ObservedTestDataCandidate[] {
  if (!safeUrl) {
    return [];
  }

  let url: URL;

  try {
    url =
      new URL(safeUrl);
  } catch {
    return [];
  }

  const values:
    ObservedTestDataCandidate[] = [];

  const seen =
    new Set<string>();

  for (
    const key
    of url.searchParams.keys()
  ) {
    if (
      values.length >= MAX_VALUES
    ) {
      break;
    }

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    if (
      !SAFE_QUERY_PROPERTY.test(key)
      || isDeniedKey(key)
    ) {
      continue;
    }

    const all =
      url.searchParams.getAll(key);

    /*
     * O Test Data QUERY existente materializa
     * um valor por selector.
     *
     * Portanto não tentamos reinterpretar:
     *
     * ?tag=a&tag=b
     *
     * como um selector escalar.
     */
    if (
      all.length !== 1
    ) {
      continue;
    }

    const candidate =
      candidateFor(
        "QUERY",
        key,
        all[0],
      );

    if (candidate) {
      values.push(candidate);
    }
  }

  return values;
}

function canonicalizeCandidates(
  values: ObservedTestDataCandidate[],
): ObservedTestDataCandidate[] {
  return [...values]
    .sort((a, b) => {
      const targetOrder =
        a.target.localeCompare(
          b.target,
        );

      if (
        targetOrder !== 0
      ) {
        return targetOrder;
      }

      const selectorOrder =
        a.selector.localeCompare(
          b.selector,
        );

      if (
        selectorOrder !== 0
      ) {
        return selectorOrder;
      }

      return a.valueType.localeCompare(
        b.valueType,
      );
    });
}

async function sha256Hex(
  value: string,
): Promise<string> {
  const bytes =
    new TextEncoder()
      .encode(value);

  const digest =
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        bytes,
      ),
    );

  return [...digest]
    .map(
      (byte) =>
        byte
          .toString(16)
          .padStart(2, "0"),
    )
    .join("");
}

/*
 * C2-E adiciona safeUrl como quarto argumento opcional.
 *
 * Isso preserva source compatibility:
 *
 * chamadas antigas com os três argumentos BODY
 * continuam válidas.
 *
 * O processor será atualizado para passar:
 *
 * observation.safeUrl
 */
export async function extractObservedTestData(
  contentType: string | null | undefined,
  body: string | null | undefined,
  truncated: boolean,
  safeUrl: string | null | undefined = null,
): Promise<ObservedTestDataSignal | null> {
  const normalizedContentType =
    String(contentType ?? "")
      .split(";", 1)[0]!
      .trim()
      .toLowerCase();

  let bodyEncoding:
    | Exclude<
      ObservedTestDataEncoding,
      "QUERY"
    >
    | null = null;

  let bodyValues:
    ObservedTestDataCandidate[] = [];

  /*
   * truncated pertence somente ao body.
   *
   * Mesmo que o body esteja truncado ou ausente,
   * QUERY ainda pode ser capturada da safeUrl.
   */
  if (
    body
    && !truncated
  ) {
    if (
      normalizedContentType
        === "application/json"
      || normalizedContentType
        === "text/json"
      || normalizedContentType
        .endsWith("+json")
    ) {
      bodyEncoding = "JSON";

      bodyValues =
        extractJsonValues(body);
    } else if (
      normalizedContentType
        === "application/x-www-form-urlencoded"
    ) {
      bodyEncoding =
        "FORM_URLENCODED";

      bodyValues =
        extractFormValues(body);
    }
  }

  const queryValues =
    extractQueryValues(
      safeUrl,
    );

  if (
    bodyValues.length === 0
    && queryValues.length === 0
  ) {
    return null;
  }

  /*
   * Mantemos o limite do contrato v1.
   *
   * O sample continua sendo uma única observação
   * correlacionada da request.
   */
  const canonical =
    canonicalizeCandidates([
      ...bodyValues,
      ...queryValues,
    ])
      .slice(0, MAX_VALUES);

  if (
    canonical.length === 0
  ) {
    return null;
  }

  /*
   * QUERY-only:
   *
   * GET /holidays?fromDate=...&toDate=...
   *
   * encoding = QUERY
   *
   * BODY + QUERY:
   *
   * preservamos o encoding do body e os targets
   * dentro de values distinguem BODY de QUERY.
   */
  const encoding:
    ObservedTestDataEncoding =
      bodyEncoding
      && bodyValues.length > 0
        ? bodyEncoding
        : "QUERY";

  const fingerprintPayload =
    JSON.stringify({
      encoding,
      values: canonical,
    });

  return {
    contractVersion:
      OBSERVED_TEST_DATA_CONTRACT_VERSION,

    encoding,

    sampleFingerprint:
      `otds_${(
        await sha256Hex(
          fingerprintPayload,
        )
      ).slice(0, 40)}`,

    values:
      canonical,
  };
}