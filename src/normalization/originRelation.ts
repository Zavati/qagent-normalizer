export type OriginRelation = "SAME_ORIGIN" | "SAME_SITE_HEURISTIC" | "EXTERNAL" | "UNKNOWN";

const COMPOUND_SUFFIXES = new Set([
  "com.br", "com.au", "co.uk", "org.uk", "gov.uk", "co.jp", "co.nz", "com.mx", "com.ar", "com.co",
]);

function siteKey(hostname: string): string {
  const labels = hostname.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const last2 = labels.slice(-2).join(".");
  if (COMPOUND_SUFFIXES.has(last2) && labels.length >= 3) return labels.slice(-3).join(".");
  return last2;
}

export function classifyOriginRelation(pageUrl: string | null, apiUrl: string): OriginRelation {
  if (!pageUrl) return "UNKNOWN";
  let page: URL;
  let api: URL;
  try {
    page = new URL(pageUrl);
    api = new URL(apiUrl);
  } catch {
    return "UNKNOWN";
  }
  if (page.origin === api.origin) return "SAME_ORIGIN";
  if (siteKey(page.hostname) === siteKey(api.hostname)) return "SAME_SITE_HEURISTIC";
  return "EXTERNAL";
}
