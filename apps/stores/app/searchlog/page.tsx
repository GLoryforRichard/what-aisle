import { gateStorePage } from '../_tenant/gate';
import PasscodeGate from '@/components/PasscodeGate';
import SearchLogClient from './searchlog-client';

/**
 * Staff search-history review — server wrapper. Same gating as /admin
 * ('admin' audience): unknown stores 404, suspended/canceled/pending render
 * their status pages (PRD F-7). PasscodeGate establishes the `wa_admin`
 * session the /api/search-logs call needs.
 */
export default async function SearchLogPage() {
  const gate = await gateStorePage('admin');
  if (gate.blocked) return gate.blocked;

  return (
    <PasscodeGate cancelHref="/">
      <SearchLogClient />
    </PasscodeGate>
  );
}
