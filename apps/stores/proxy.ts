/**
 * Next.js 16 Proxy (the file convention formerly known as middleware —
 * see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 *
 * Multi-tenant subdomain routing (PRD F-7):
 *   Host: <slug>.what-aisle.com  →  inject `x-store-slug: <slug>` request header
 *
 * No route rewriting for valid tenants — the existing app/ structure is
 * untouched; lib/store-context.ts resolves the header into a Store document.
 *
 * Kept intentionally dependency-light (lib/slug.ts only — no MongoDB here):
 * the proxy is bundled separately and runs on every request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { SLUG_REGEX, RESERVED_SLUGS } from '@/lib/slug';

const APEX_DOMAIN = 'what-aisle.com';
const PORTAL_URL = 'https://what-aisle.com';
const NOT_FOUND_PATH = '/store-not-found';

/**
 * Host → candidate slug.
 *  - <slug>.what-aisle.com                    → slug (production, wildcard DNS)
 *  - <slug>.localhost                         → slug (local dev)
 *  - anything else (localhost, 127.0.0.1, VM) → DEV_STORE_SLUG fallback
 * Returns null when no slug can be derived (apex/www or bare host without
 * DEV_STORE_SLUG).
 */
function extractSlug(hostname: string): string | null {
  if (hostname === APEX_DOMAIN) {
    // The apex is the portal's vhost — if a request lands here anyway, treat
    // it as "no tenant" rather than redirecting (avoids a redirect loop).
    // `www.` is NOT special-cased: 'www' extracts as a reserved slug → 308.
    return null;
  }
  if (hostname.endsWith(`.${APEX_DOMAIN}`)) {
    return hostname.slice(0, -(APEX_DOMAIN.length + 1));
  }
  if (hostname.endsWith('.localhost')) {
    return hostname.slice(0, -'.localhost'.length);
  }
  return process.env.DEV_STORE_SLUG?.trim().toLowerCase() || null;
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // `x-store-slug` is trusted downstream — NEVER let a client smuggle it in.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete('x-store-slug');

  // /api/internal/* does its own bearer auth (and Caddy 403s it on the public
  // vhosts) — pass through untouched. Next internals are excluded by the
  // matcher, this is just belt-and-braces.
  if (pathname.startsWith('/api/internal') || pathname.startsWith('/_next')) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const host = req.headers.get('host') ?? '';
  const hostname = host.split(':')[0].toLowerCase();
  const slug = extractSlug(hostname);

  // Founder console — passes through without a tenant; /superadmin routes
  // carry their own auth (Caddy basic_auth + SUPERADMIN_TOKEN, task #4).
  if (slug === 'superadmin') {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Other reserved subdomains are not stores — bounce to the portal.
  if (slug && RESERVED_SLUGS.has(slug)) {
    return NextResponse.redirect(PORTAL_URL, 308);
  }

  // No slug, or one that can't be a store → tenant not-found.
  if (!slug || !SLUG_REGEX.test(slug)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ ok: false, error: 'store not found' }, { status: 404 });
    }
    if (pathname === NOT_FOUND_PATH) {
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    return NextResponse.rewrite(new URL(NOT_FOUND_PATH, req.url), {
      request: { headers: requestHeaders },
    });
  }

  // Valid tenant — inject the slug; store lookup / status gating happens in
  // lib/store-context.ts (the proxy stays DB-free).
  requestHeaders.set('x-store-slug', slug);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Everything except Next internals and static assets (paths with a dot).
  // NOTE: /api IS matched on purpose — API routes need x-store-slug too;
  // /api/internal is passed through inside the handler above.
  matcher: ['/((?!_next/static|_next/image|.*\\..*).*)'],
};
