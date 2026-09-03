import {
  classifyPathSegment,
  type PathParameterKind,
} from "./pathNormalizer";
import type { HandoffObservedQuerySample } from "../contracts/handoff";

export const OBSERVED_TEST_DATA_CONTRACT_VERSION =
  "qagent.observed-test-data.v1" as const;

export type ObservedTestDataEncoding =
  | "JSON"
  | "FORM_URLENCODED"
  | "QUERY"
  | "PATH";

export type ObservedTestDataTarget =
  | "BODY"
  | "QUERY"
  | "PATH_PARAM";

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

  /*
   * C2-F: somente PATH_PARAM.
   * segmentIndex = posição zero-based no pathname.
   * occurrence = ocorrência zero-based do mesmo placeholder.
   */
  segmentIndex?: number;
  occurrence?: number;
}

export interface ObservedTestDataSelector {
  target: "QUERY";
  selector: string;
}

export interface ObservedTestDataSignal {
  contractVersion: typeof OBSERVED_TEST_DATA_CONTRACT_VERSION;
  encoding: ObservedTestDataEncoding;
  sampleFingerprint: string;
  selectors?: ObservedTestDataSelector[];
  values: ObservedTestDataCandidate[];
}

const MAX_DEPTH = 6;
const MAX_VALUES = 48;
const MAX_SELECTORS = 48;
const MAX_STRING_BYTES = 256;
const MAX_SELECTOR_BYTES = 256;

const SAFE_BODY_PROPERTY =
  /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

const SAFE_QUERY_PROPERTY =
  /^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/;

const SAFE_PATH_SELECTOR =
  /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const PATH_PLACEHOLDER_RE =
  /^\{([A-Za-z_][A-Za-z0-9_]{0,63})\}$/;

const NUMERIC_ID_RE = /^\d{1,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

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
    HARD_DENIED_FIELD_NAMES.has(normalizedKey(key))
    || key.toLowerCase().startsWith("redacted_field_")
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

function isForbiddenString(value: string): boolean {
  return FORBIDDEN_MARKERS.some((marker) => value.includes(marker));
}

function candidateFor(
  target: Exclude<ObservedTestDataTarget, "PATH_PARAM">,
  selector: string,
  value: unknown,
): ObservedTestDataCandidate | null {
  if (utf8Bytes(selector) > MAX_SELECTOR_BYTES) return null;

  if (value === null) {
    return { target, selector, valueType: "NULL", value: null };
  }

  if (typeof value === "boolean") {
    return { target, selector, valueType: "BOOLEAN", value };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return {
      target,
      selector,
      valueType: Number.isSafeInteger(value) ? "INTEGER" : "NUMBER",
      value,
    };
  }

  if (typeof value === "string") {
    if (
      utf8Bytes(value) > MAX_STRING_BYTES
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

function extractJsonValues(body: string): ObservedTestDataCandidate[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return [];
  }

  if (!isPlainObject(parsed)) return [];

  const values: ObservedTestDataCandidate[] = [];

  const walk = (
    node: Record<string, unknown>,
    prefix: string,
    depth: number,
  ): void => {
    if (depth > MAX_DEPTH || values.length >= MAX_VALUES) return;

    for (const [key, child] of Object.entries(node)) {
      if (values.length >= MAX_VALUES) break;

      if (
        !SAFE_BODY_PROPERTY.test(key)
        || isDeniedKey(key)
      ) {
        continue;
      }

      const selector = `${prefix}.${key}`;

      if (isPlainObject(child)) {
        walk(child, selector, depth + 1);
        continue;
      }

      if (Array.isArray(child)) continue;

      const candidate = candidateFor("BODY", selector, child);
      if (candidate) values.push(candidate);
    }
  };

  walk(parsed, "$", 0);
  return values;
}

function extractFormValues(body: string): ObservedTestDataCandidate[] {
  const params = new URLSearchParams(body);
  const values: ObservedTestDataCandidate[] = [];
  const seen = new Set<string>();

  for (const key of params.keys()) {
    if (values.length >= MAX_VALUES) break;
    if (seen.has(key)) continue;
    seen.add(key);

    if (
      !SAFE_BODY_PROPERTY.test(key)
      || isDeniedKey(key)
    ) {
      continue;
    }

    const distinct = [...new Set(params.getAll(key))];
    if (distinct.length !== 1) continue;

    const candidate =
      candidateFor("BODY", `$.${key}`, distinct[0]);

    if (candidate) values.push(candidate);
  }

  return values;
}

function extractQuerySelectors(
  safeUrl: string | null | undefined,
): ObservedTestDataSelector[] {
  if (!safeUrl) return [];

  let url: URL;
  try {
    url = new URL(safeUrl);
  } catch {
    return [];
  }

  const selectors: ObservedTestDataSelector[] = [];
  const seen = new Set<string>();

  for (const key of url.searchParams.keys()) {
    if (selectors.length >= MAX_SELECTORS) break;
    if (seen.has(key)) continue;
    seen.add(key);

    if (
      !SAFE_QUERY_PROPERTY.test(key)
      || isDeniedKey(key)
      || utf8Bytes(key) > MAX_SELECTOR_BYTES
    ) {
      continue;
    }

    selectors.push({
      target: "QUERY",
      selector: key,
    });
  }

  return selectors;
}

function extractQueryValues(
  safeUrl: string | null | undefined,
): ObservedTestDataCandidate[] {
  if (!safeUrl) return [];

  let url: URL;
  try {
    url = new URL(safeUrl);
  } catch {
    return [];
  }

  const values: ObservedTestDataCandidate[] = [];
  const seen = new Set<string>();

  for (const key of url.searchParams.keys()) {
    if (values.length >= MAX_VALUES) break;
    if (seen.has(key)) continue;
    seen.add(key);

    if (
      !SAFE_QUERY_PROPERTY.test(key)
      || isDeniedKey(key)
    ) {
      continue;
    }

    const all = url.searchParams.getAll(key);
    if (all.length !== 1) continue;

    const candidate =
      candidateFor("QUERY", key, all[0]);

    if (candidate) values.push(candidate);
  }

  return values;
}

function candidateForObservedQueryLiteral(
  selector: string,
  value: string,
): ObservedTestDataCandidate | null {
  if (value === "true" || value === "false") {
    return candidateFor("QUERY", selector, value === "true");
  }

  if (/^-?(?:0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) {
      return candidateFor("QUERY", selector, parsed);
    }
  }

  if (/^-?(?:0|[1-9]\d*)\.\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return candidateFor("QUERY", selector, parsed);
    }
  }

  return candidateFor("QUERY", selector, value);
}

function extractQueryValuesFromSample(
  sample: HandoffObservedQuerySample | null | undefined,
): ObservedTestDataCandidate[] {
  if (sample?.contractVersion !== "qagent.observed-query-sample.v1") return [];
  if (!isPlainObject(sample.values)) return [];

  const values: ObservedTestDataCandidate[] = [];
  for (const [key, value] of Object.entries(sample.values)) {
    if (values.length >= MAX_VALUES) break;
    if (
      !SAFE_QUERY_PROPERTY.test(key)
      || isDeniedKey(key)
      || typeof value !== "string"
    ) {
      continue;
    }
    const candidate = candidateForObservedQueryLiteral(key, value);
    if (candidate) values.push(candidate);
  }
  return values;
}

function reusablePathValue(
  kind: PathParameterKind,
  value: string,
): boolean {
  if (
    utf8Bytes(value) > MAX_STRING_BYTES
    || isForbiddenString(value)
  ) {
    return false;
  }

  /*
   * Fail-closed:
   * long-hex genérico continua normalizado historicamente como {id},
   * mas não vira massa automática. {id} reutilizável é numérico.
   */
  if (kind === "id") return NUMERIC_ID_RE.test(value);
  if (kind === "uuid") return UUID_RE.test(value);
  if (kind === "objectId") return OBJECT_ID_RE.test(value);
  if (kind === "ulid") return ULID_RE.test(value);
  return false;
}

/*
 * C2-F:
 * compara pathname real e normalizedPath segmento a segmento.
 *
 * /companies/10/employees/25
 * /companies/{id}/employees/{id}
 *
 * gera no mesmo sample:
 * id segmentIndex=1 occurrence=0 value=10
 * id segmentIndex=3 occurrence=1 value=25
 */
function extractPathValues(
  safeUrl: string | null | undefined,
  normalizedPath: string | null | undefined,
): ObservedTestDataCandidate[] {
  if (!safeUrl || !normalizedPath) return [];

  let url: URL;
  try {
    url = new URL(safeUrl);
  } catch {
    return [];
  }

  const observedSegments =
    url.pathname.split("/").filter(Boolean);

  const normalizedSegments =
    normalizedPath.split("/").filter(Boolean);

  if (observedSegments.length !== normalizedSegments.length) {
    return [];
  }

  const values: ObservedTestDataCandidate[] = [];
  const occurrences = new Map<string, number>();

  for (
    let segmentIndex = 0;
    segmentIndex < normalizedSegments.length;
    segmentIndex += 1
  ) {
    if (values.length >= MAX_VALUES) break;

    const normalizedSegment =
      normalizedSegments[segmentIndex]!;

    const match =
      PATH_PLACEHOLDER_RE.exec(normalizedSegment);

    if (!match) continue;

    const selector = match[1]!;

    if (
      !SAFE_PATH_SELECTOR.test(selector)
      || isDeniedKey(selector)
      || utf8Bytes(selector) > MAX_SELECTOR_BYTES
    ) {
      continue;
    }

    let observedValue: string;
    try {
      observedValue =
        decodeURIComponent(observedSegments[segmentIndex]!);
    } catch {
      continue;
    }

    const observedKind =
      classifyPathSegment(observedValue);

    if (
      observedKind === null
      || observedKind !== selector
      || !reusablePathValue(observedKind, observedValue)
    ) {
      continue;
    }

    const occurrence =
      occurrences.get(selector) ?? 0;

    occurrences.set(selector, occurrence + 1);

    values.push({
      target: "PATH_PARAM",
      selector,
      valueType: "STRING",
      value: observedValue,
      segmentIndex,
      occurrence,
    });
  }

  return values;
}

function canonicalizeCandidates(
  values: ObservedTestDataCandidate[],
): ObservedTestDataCandidate[] {
  return [...values].sort((a, b) => {
    const targetOrder = a.target.localeCompare(b.target);
    if (targetOrder !== 0) return targetOrder;

    if (
      a.target === "PATH_PARAM"
      && b.target === "PATH_PARAM"
    ) {
      const segmentOrder =
        (a.segmentIndex ?? Number.MAX_SAFE_INTEGER)
        - (b.segmentIndex ?? Number.MAX_SAFE_INTEGER);

      if (segmentOrder !== 0) return segmentOrder;

      const occurrenceOrder =
        (a.occurrence ?? Number.MAX_SAFE_INTEGER)
        - (b.occurrence ?? Number.MAX_SAFE_INTEGER);

      if (occurrenceOrder !== 0) return occurrenceOrder;
    }

    const selectorOrder =
      a.selector.localeCompare(b.selector);

    if (selectorOrder !== 0) return selectorOrder;

    return a.valueType.localeCompare(b.valueType);
  });
}

function canonicalizeSelectors(
  selectors: ObservedTestDataSelector[],
): ObservedTestDataSelector[] {
  return [...selectors].sort(
    (a, b) => a.selector.localeCompare(b.selector),
  );
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes),
  );

  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/*
 * C2-F adiciona normalizedPath como quinto argumento opcional.
 * Chamadas antigas com 3/4 argumentos continuam válidas.
 */
export async function extractObservedTestData(
  contentType: string | null | undefined,
  body: string | null | undefined,
  truncated: boolean,
  safeUrl: string | null | undefined = null,
  normalizedPath: string | null | undefined = null,
  requestQuerySample: HandoffObservedQuerySample | null | undefined = null,
): Promise<ObservedTestDataSignal | null> {
  const normalizedContentType =
    String(contentType ?? "")
      .split(";", 1)[0]!
      .trim()
      .toLowerCase();

  let bodyEncoding:
    | "JSON"
    | "FORM_URLENCODED"
    | null = null;

  let bodyValues: ObservedTestDataCandidate[] = [];

  if (body && !truncated) {
    if (
      normalizedContentType === "application/json"
      || normalizedContentType === "text/json"
      || normalizedContentType.endsWith("+json")
    ) {
      bodyEncoding = "JSON";
      bodyValues = extractJsonValues(body);
    } else if (
      normalizedContentType
        === "application/x-www-form-urlencoded"
    ) {
      bodyEncoding = "FORM_URLENCODED";
      bodyValues = extractFormValues(body);
    }
  }

  const querySelectors =
    extractQuerySelectors(safeUrl);

  const sampledQueryValues =
    extractQueryValuesFromSample(requestQuerySample);

  const queryValues =
    sampledQueryValues.length > 0
      ? sampledQueryValues
      : extractQueryValues(safeUrl);

  const pathValues =
    extractPathValues(safeUrl, normalizedPath);

  if (
    bodyValues.length === 0
    && queryValues.length === 0
    && querySelectors.length === 0
    && pathValues.length === 0
  ) {
    return null;
  }

  const canonical =
    canonicalizeCandidates([
      ...bodyValues,
      ...queryValues,
      ...pathValues,
    ]).slice(0, MAX_VALUES);

  const canonicalSelectors =
    canonicalizeSelectors(querySelectors)
      .slice(0, MAX_SELECTORS);

  if (
    canonical.length === 0
    && canonicalSelectors.length === 0
  ) {
    return null;
  }

  const encoding: ObservedTestDataEncoding =
    bodyEncoding && bodyValues.length > 0
      ? bodyEncoding
      : (
        queryValues.length > 0
        || querySelectors.length > 0
      )
        ? "QUERY"
        : "PATH";

  /*
   * BODY/QUERY sem PATH_PARAM preservam o formato histórico.
   * PATH_PARAM entra em values com posição e passa a fazer
   * parte do fingerprint/sample correlacionado.
   */
  const fingerprintPayload =
    canonical.length > 0
      ? JSON.stringify({
        encoding,
        values: canonical,
      })
      : JSON.stringify({
        encoding,
        selectors: canonicalSelectors,
      });

  return {
    contractVersion:
      OBSERVED_TEST_DATA_CONTRACT_VERSION,

    encoding,

    sampleFingerprint:
      `otds_${(
        await sha256Hex(fingerprintPayload)
      ).slice(0, 40)}`,

    ...(canonicalSelectors.length > 0
      ? { selectors: canonicalSelectors }
      : {}),

    values: canonical,
  };
}
