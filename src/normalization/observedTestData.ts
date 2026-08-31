export const OBSERVED_TEST_DATA_CONTRACT_VERSION = "qagent.observed-test-data.v1" as const;

export type ObservedTestDataEncoding = "JSON" | "FORM_URLENCODED";
export type ObservedTestDataValueType = "STRING" | "INTEGER" | "NUMBER" | "BOOLEAN" | "NULL";

export interface ObservedTestDataCandidate {
  target: "BODY";
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
const SAFE_PROPERTY = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const FORBIDDEN_MARKERS = ["[REDACTED]", "[TRUNCATED]", "__qagent_redacted__", "__qagent_truncated__"];
const HARD_DENIED_FIELD_NAMES = new Set([
  "authorization", "proxyauthorization", "cookie", "setcookie", "xapikey", "apikey", "xauthtoken",
  "password", "passwd", "pwd", "accesstoken", "refreshtoken", "idtoken", "clientsecret", "clientkey",
  "secret", "secretkey", "privatekey", "sessiontoken", "sessionid", "sid", "token", "authtoken",
  "bearertoken", "jwt", "credential", "credentials", "csrftoken", "xcsrftoken", "xsrftoken", "otp",
  "pin", "cvv", "awssecretaccesskey", "privatekeydata",
]);

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isDeniedKey(key: string): boolean {
  return HARD_DENIED_FIELD_NAMES.has(normalizedKey(key)) || key.startsWith("redacted_field_");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isForbiddenString(value: string): boolean {
  return FORBIDDEN_MARKERS.some((marker) => value.includes(marker));
}

function candidateFor(selector: string, value: unknown): ObservedTestDataCandidate | null {
  if (utf8Bytes(selector) > MAX_SELECTOR_BYTES) return null;
  if (value === null) return { target: "BODY", selector, valueType: "NULL", value: null };
  if (typeof value === "boolean") return { target: "BODY", selector, valueType: "BOOLEAN", value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return {
      target: "BODY",
      selector,
      valueType: Number.isSafeInteger(value) ? "INTEGER" : "NUMBER",
      value,
    };
  }
  if (typeof value === "string") {
    if (utf8Bytes(value) > MAX_STRING_BYTES || isForbiddenString(value)) return null;
    return { target: "BODY", selector, valueType: "STRING", value };
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
  const walk = (node: Record<string, unknown>, prefix: string, depth: number): void => {
    if (depth > MAX_DEPTH || values.length >= MAX_VALUES) return;
    for (const [key, child] of Object.entries(node)) {
      if (values.length >= MAX_VALUES) break;
      if (!SAFE_PROPERTY.test(key) || isDeniedKey(key)) continue;
      const selector = `${prefix}.${key}`;
      if (isPlainObject(child)) {
        walk(child, selector, depth + 1);
        continue;
      }
      // Arrays are intentionally deferred until the Test Data selector DSL gains
      // an explicit array/wildcard contract. Never guess an index selector here.
      if (Array.isArray(child)) continue;
      const candidate = candidateFor(selector, child);
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
    if (!SAFE_PROPERTY.test(key) || isDeniedKey(key)) continue;
    const all = params.getAll(key);
    const distinct = [...new Set(all)];
    // Repeated form keys need a collection selector contract. Preserve only the
    // unambiguous single-value case in v1.
    if (distinct.length !== 1) continue;
    const candidate = candidateFor(`$.${key}`, distinct[0]);
    if (candidate) values.push(candidate);
  }
  return values;
}

function canonicalizeCandidates(values: ObservedTestDataCandidate[]): ObservedTestDataCandidate[] {
  return [...values].sort((a, b) => {
    const selectorOrder = a.selector.localeCompare(b.selector);
    if (selectorOrder !== 0) return selectorOrder;
    return a.valueType.localeCompare(b.valueType);
  });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function extractObservedTestData(
  contentType: string | null | undefined,
  body: string | null | undefined,
  truncated: boolean,
): Promise<ObservedTestDataSignal | null> {
  if (!body || truncated) return null;
  const normalizedContentType = String(contentType ?? "").split(";", 1)[0]!.trim().toLowerCase();

  let encoding: ObservedTestDataEncoding | null = null;
  let values: ObservedTestDataCandidate[] = [];
  if (normalizedContentType === "application/json" || normalizedContentType === "text/json" || normalizedContentType.endsWith("+json")) {
    encoding = "JSON";
    values = extractJsonValues(body);
  } else if (normalizedContentType === "application/x-www-form-urlencoded") {
    encoding = "FORM_URLENCODED";
    values = extractFormValues(body);
  }

  if (!encoding || values.length === 0) return null;
  const canonical = canonicalizeCandidates(values);
  const fingerprintPayload = JSON.stringify({ encoding, values: canonical });
  return {
    contractVersion: OBSERVED_TEST_DATA_CONTRACT_VERSION,
    encoding,
    sampleFingerprint: `otds_${(await sha256Hex(fingerprintPayload)).slice(0, 40)}`,
    values: canonical,
  };
}
