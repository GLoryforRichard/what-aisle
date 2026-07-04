/**
 * Root not-found boundary — renders whenever notFound() is thrown (unknown
 * store slug via app/_tenant/gate.tsx, or app/store-not-found for hosts whose
 * slug can never be a store) and for any unmatched URL. Ships the tenant
 * not-found UI with a real HTTP 404 status.
 */

import { TenantNotFound } from './_tenant/status-pages';

export default function NotFound() {
  return <TenantNotFound />;
}
