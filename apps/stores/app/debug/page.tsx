import { gateStorePage } from '../_tenant/gate';
import PasscodeGate from '@/components/PasscodeGate';
import DebugClient from './debug-client';

/**
 * Raw DB inspector — server wrapper. Same gating as /admin ('admin'
 * audience): unknown stores 404, suspended/canceled/pending render their
 * status pages (PRD F-7). PasscodeGate establishes the `wa_admin` session
 * the /api/debug call needs.
 */
export default async function DebugPage() {
  const gate = await gateStorePage('admin');
  if (gate.blocked) return gate.blocked;

  return (
    <PasscodeGate cancelHref="/">
      <DebugClient />
    </PasscodeGate>
  );
}
