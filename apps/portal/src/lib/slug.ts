/**
 * Store slug rules — MUST stay identical to the stores app
 * (apps/stores). Any change here needs to be mirrored there (PRD 9.1-#8).
 *
 * A slug is the subdomain of a store: {slug}.what-aisle.com
 */

/** 3-30 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphen */
export const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/;

export const SLUG_MAX_LENGTH = 30;

/** Subdomains that can never be claimed by a store */
export const RESERVED_SLUGS = [
  'www',
  'app',
  'api',
  'admin',
  'superadmin',
  'mail',
  'smtp',
  'ftp',
  'portal',
  'dashboard',
  'docs',
  'blog',
  'help',
  'status',
  'dev',
  'staging',
  'test',
  'demo',
  'store',
  'shop',
  'my',
  'support',
  'billing',
  'cdn',
  'static',
  'assets',
] as const;

/**
 * Convert an arbitrary store name into a slug candidate:
 * lowercase, strip diacritics, spaces/invalid chars → hyphens,
 * collapse repeated hyphens, trim leading/trailing hyphens,
 * cap at 30 chars.
 *
 * NOTE: the result is a best-effort candidate — always run it
 * through validateSlug() before using it.
 */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      // strip diacritics: é → e, ü → u, ...
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      // any run of non [a-z0-9] becomes a single hyphen
      .replace(/[^a-z0-9]+/g, '-')
      // collapse repeated hyphens
      .replace(/-+/g, '-')
      // trim hyphens
      .replace(/^-+|-+$/g, '')
      // cap length, then re-trim a possible trailing hyphen
      .slice(0, SLUG_MAX_LENGTH)
      .replace(/-+$/g, '')
  );
}

export type SlugValidationResult =
  | { valid: true; slug: string }
  | { valid: false; slug: string; reason: 'invalid' | 'reserved' };

/**
 * Validate a slug against format rules and the reserved list.
 * DB uniqueness is NOT checked here — see the check-slug action.
 */
export function validateSlug(slug: string): SlugValidationResult {
  if (!SLUG_REGEX.test(slug)) {
    return { valid: false, slug, reason: 'invalid' };
  }
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) {
    return { valid: false, slug, reason: 'reserved' };
  }
  return { valid: true, slug };
}
