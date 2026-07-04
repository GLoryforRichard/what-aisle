/**
 * Store resolution + status gating (PRD F-7).
 *
 * proxy.ts turns the Host header into an `x-store-slug` request header;
 * this module turns that slug into a `Store` document with a small in-process
 * cache (TTL 60 s — "go live" propagates within a minute; internal API writes
 * call bustStoreCache() to make it immediate).
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from './mongodb';
import { Store, StoreStatus, STORES_COLLECTION } from './types';

export const STORE_SLUG_HEADER = 'x-store-slug';

const CACHE_TTL_MS = 60_000;

// Negative results (slug → null) are cached too, so an unknown-subdomain
// crawler can't hammer MongoDB.
const storeCache = new Map<string, { store: Store | null; expiresAt: number }>();

export async function getStoreBySlug(slug: string): Promise<Store | null> {
  const key = slug.trim().toLowerCase();
  if (!key) return null;
  const hit = storeCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.store;

  const db = await getDb();
  const store = await db.collection<Store>(STORES_COLLECTION).findOne({ slug: key });
  storeCache.set(key, { store, expiresAt: Date.now() + CACHE_TTL_MS });
  return store;
}

/** Invalidate one slug (or the whole cache). Called by internal-API writes. */
export function bustStoreCache(slug?: string): void {
  if (slug) storeCache.delete(slug.trim().toLowerCase());
  else storeCache.clear();
}

// ─────────────────────────────────────────────────────────────
// Status gating
// ─────────────────────────────────────────────────────────────

export type StoreAudience = 'public' | 'admin';

/**
 * Which lifecycle states may see which surface:
 *  - public (customer search pages): 'live' only;
 *  - admin (/admin staff tools, /superadmin): also 'awaiting_video' and
 *    'building' so the founder can preview while provisioning (PRD F-7).
 */
export function storeStatusAllows(status: StoreStatus, audience: StoreAudience): boolean {
  if (status === 'live') return true;
  if (audience === 'admin') return status === 'awaiting_video' || status === 'building';
  return false;
}

/** Statuses under which the store's APIs respond (staff prep + live traffic). */
const API_ALLOWED_STATUSES: readonly StoreStatus[] = ['live', 'awaiting_video', 'building'];

export type RequireStoreResult =
  | { ok: true; store: Store }
  | { ok: false; response: NextResponse };

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Resolve the tenant for an API route from the proxy-injected header.
 * 404s when the header is absent or no store matches; 403s when the store
 * exists but is not in an active status. Usage:
 *
 *   const gate = await requireStore(req);
 *   if (!gate.ok) return gate.response;
 *   const store = gate.store;
 */
export async function requireStore(
  req: NextRequest,
  opts?: { allow?: readonly StoreStatus[] }
): Promise<RequireStoreResult> {
  const slug = req.headers.get(STORE_SLUG_HEADER)?.trim().toLowerCase();
  if (!slug) return { ok: false, response: jsonError(404, 'store not found') };

  const store = await getStoreBySlug(slug);
  if (!store) return { ok: false, response: jsonError(404, 'store not found') };

  const allow = opts?.allow ?? API_ALLOWED_STATUSES;
  if (!allow.includes(store.status)) {
    return { ok: false, response: jsonError(403, 'store is not active') };
  }
  return { ok: true, store };
}

/**
 * Store for the current request in a Server Component / layout, via the
 * proxy-injected header. Returns null off-tenant (unknown host, superadmin).
 */
export async function getStoreOrNull(): Promise<Store | null> {
  const h = await headers();
  const slug = h.get(STORE_SLUG_HEADER)?.trim().toLowerCase();
  if (!slug) return null;
  return getStoreBySlug(slug);
}
