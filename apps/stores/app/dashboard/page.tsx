import { gateStorePage } from '../_tenant/gate';
import DashboardClient from './dashboard-client';

/**
 * Staff dashboard — server wrapper. Same gating as /admin ('admin' audience):
 * unknown stores 404, suspended/canceled/pending render their status pages,
 * 'building'/'awaiting_video' stay visible for the founder (PRD F-7).
 */
export default async function DashboardPage() {
  const gate = await gateStorePage('admin');
  if (gate.blocked) return gate.blocked;

  return <DashboardClient />;
}
