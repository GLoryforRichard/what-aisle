/**
 * Routable target for proxy.ts rewrites: hosts whose slug can never be a
 * store (bad format / no derivable slug) land here for every path. Throws
 * notFound() so the response carries a real HTTP 404 status while
 * app/not-found.tsx renders the TenantNotFound UI. Valid-but-unknown slugs
 * reach the same boundary via app/_tenant/gate.tsx.
 */

import { notFound } from 'next/navigation';

// Force per-request rendering: a prerendered notFound() result is replayed
// from the cache with HTTP 200 in this Next build; rendering dynamically
// lets the server set the real 404 status before anything streams.
export const dynamic = 'force-dynamic';

export default function StoreNotFoundPage() {
  notFound();
}
