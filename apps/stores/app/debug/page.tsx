import { gateStorePage } from '../_tenant/gate';
import DebugClient from './debug-client';

/**
 * Raw DB inspector — server wrapper. Same gating as /admin ('admin'
 * audience): unknown stores 404, suspended/canceled/pending render their
 * status pages (PRD F-7).
 */
export default async function DebugPage() {
  const gate = await gateStorePage('admin');
  if (gate.blocked) return gate.blocked;

  return <DebugClient />;
}
