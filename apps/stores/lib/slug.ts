/**
 * Store slug rules — the slug IS the tenant id (store_id) and the subdomain
 * (`<slug>.whataisle.com`), so validation is security-relevant.
 *
 * NOTE: the portal app (apps/portal) keeps its own copy of these rules for the
 * landing-page name checker. Any change here must be mirrored there (PRD §9.1
 * risk #8) until the rules are extracted into a shared package.
 */

/** 3–30 chars, lowercase alphanumeric + hyphens, must start/end alphanumeric. */
export const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/;

/**
 * Subdomains that must never become stores. `superadmin` is routed to the
 * founder console by proxy.ts; the rest 308-redirect to the portal.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www', 'app', 'api', 'admin', 'superadmin', 'mail', 'smtp', 'ftp',
  'portal', 'dashboard', 'docs', 'blog', 'help', 'status', 'dev',
  'staging', 'test', 'demo', 'store', 'shop', 'my', 'support',
  'billing', 'cdn', 'static', 'assets',
]);

export type SlugValidation =
  | { ok: true; slug: string }
  | { ok: false; reason: 'format' | 'reserved' };

/** Validate a candidate slug. Lowercases + trims before checking. */
export function validateSlug(raw: string): SlugValidation {
  const slug = (raw ?? '').trim().toLowerCase();
  if (!SLUG_REGEX.test(slug)) return { ok: false, reason: 'format' };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'reserved' };
  return { ok: true, slug };
}
