import { gateStorePage } from '../_tenant/gate';
import AdminWorkspace from '@/components/AdminWorkspace';

/**
 * Staff workspace — server wrapper. Unlike the public page, 'awaiting_video'
 * and 'building' stores are allowed here so the founder can preview the store
 * while provisioning it (PRD F-7).
 */
export default async function AdminPage() {
  const gate = await gateStorePage('admin');
  if (gate.blocked) return gate.blocked;

  return <AdminWorkspace />;
}
