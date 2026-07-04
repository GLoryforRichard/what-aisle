/**
 * Server-side page gate: resolve the tenant from the proxy-injected header,
 * apply status rules, and hand back either the Store or the status page to
 * render instead (PRD F-7).
 *
 * Usage in a server page:
 *   const gate = await gateStorePage('public');
 *   if (gate.blocked) return gate.blocked;
 *   const store = gate.store;
 */

import type { ReactElement } from 'react';
import { notFound } from 'next/navigation';
import { getStoreOrNull, storeStatusAllows, StoreAudience } from '@/lib/store-context';
import type { Store } from '@/lib/types';
import {
  TenantPending,
  TenantSuspended,
  TenantClosed,
} from './status-pages';

export type StorePageGate =
  | { store: Store; blocked: null }
  | { store: null; blocked: ReactElement };

export async function gateStorePage(audience: StoreAudience): Promise<StorePageGate> {
  const store = await getStoreOrNull();
  // Unknown store → real HTTP 404 (app/not-found.tsx renders TenantNotFound).
  if (!store) notFound();

  switch (store.status) {
    case 'canceled':
      return { store: null, blocked: <TenantClosed /> };
    case 'suspended':
      return { store: null, blocked: <TenantSuspended /> };
    default:
      if (!storeStatusAllows(store.status, audience)) {
        // pending_payment / awaiting_video / building on a public surface.
        return { store: null, blocked: <TenantPending /> };
      }
      return { store, blocked: null };
  }
}
