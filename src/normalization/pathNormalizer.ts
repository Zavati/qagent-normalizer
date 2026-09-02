const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const LONG_HEX_RE = /^[0-9a-f]{16,64}$/i;
const NUMERIC_ID_RE = /^\d{1,20}$/;

export type PathParameterKind = "uuid" | "objectId" | "ulid" | "id";

export function classifyPathSegment(segment: string): PathParameterKind | null {
  if (UUID_RE.test(segment)) return "uuid";
  if (OBJECT_ID_RE.test(segment)) return "objectId";
  if (ULID_RE.test(segment)) return "ulid";
  if (NUMERIC_ID_RE.test(segment)) return "id";
  if (LONG_HEX_RE.test(segment)) return "id";
  return null;
}

function classifySegment(segment: string): string {
  const kind = classifyPathSegment(segment);
  return kind ? `{${kind}}` : segment;
}

export interface NormalizedUrl {
  scheme: string;
  host: string;
  normalizedPath: string;
}

export function normalizeApiUrl(value: string): NormalizedUrl | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  const host = url.host.toLowerCase();
  const rawSegments = url.pathname.split("/").filter(Boolean);
  const normalizedSegments = rawSegments.map((segment) => {
    let decoded = segment;
    try { decoded = decodeURIComponent(segment); } catch { /* keep encoded segment */ }
    return encodeURIComponent(classifySegment(decoded))
      .replace(/%7B/gi, "{")
      .replace(/%7D/gi, "}");
  });
  const normalizedPath = normalizedSegments.length ? `/${normalizedSegments.join("/")}` : "/";
  return { scheme, host, normalizedPath };
}
