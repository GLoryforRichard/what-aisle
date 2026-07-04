import { gateStorePage } from '../_tenant/gate';
import PasscodeGate from '@/components/PasscodeGate';
import DashboardClient from './dashboard-client';

/**
 * Staff dashboard — server wrapper. Same gating as /admin ('admin' audience):
 * unknown stores 404, suspended/canceled/pending render their status pages,
 * 'building'/'awaiting_video' stay visible for the founder (PRD F-7).
 * PasscodeGate establishes the `wa_admin` session the /api/stats call needs.
 */
export default async function DashboardPage() {
  const gate = await gateStorePage('admin');
  if (gate.blocked) return gate.blocked;

  return (
    <PasscodeGate cancelHref="/">
      <DashboardClient />
    </PasscodeGate>
  );
}
