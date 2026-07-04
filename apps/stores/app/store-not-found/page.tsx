/**
 * Routable target for proxy.ts rewrites: hosts whose slug can never be a
 * store (bad format / no derivable slug) land here for every path.
 * Valid-but-unknown slugs render the same component via app/_tenant/gate.tsx.
 */

import { TenantNotFound } from '../_tenant/status-pages';

export const dynamic = 'force-static';

export default function StoreNotFoundPage() {
  return <TenantNotFound />;
}
