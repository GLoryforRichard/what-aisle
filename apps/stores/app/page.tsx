import { gateStorePage } from './_tenant/gate';
import CustomerHome from '@/components/CustomerHome';

/**
 * Customer landing page — server wrapper that resolves the tenant from the
 * proxy-injected header and gates on store status (public surface requires
 * 'live', PRD F-7), then hands branding to the client home screen.
 */
export default async function Page() {
  const gate = await gateStorePage('public');
  if (gate.blocked) return gate.blocked;
  const store = gate.store;

  return (
    <CustomerHome
      storeName={store.branding.displayName || store.name}
      logoUrl={store.branding.logoUrl ?? null}
    />
  );
}
