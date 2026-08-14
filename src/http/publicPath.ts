const PUBLIC_PREFIX = "/v1/normalizer";

/**
 * Cloudflare Routes forward the original pathname to the Worker.
 * Keep internal handlers independent from the public routing prefix so the
 * same Worker works on workers.dev (/health) and behind apiqagent.com
 * (/v1/normalizer/health).
 */
export function normalizePublicPathname(pathname: string): string {
  if (pathname === PUBLIC_PREFIX || pathname === `${PUBLIC_PREFIX}/`) {
    return "/";
  }

  if (pathname.startsWith(`${PUBLIC_PREFIX}/`)) {
    return pathname.slice(PUBLIC_PREFIX.length);
  }

  return pathname;
}
