import { gateStorePage } from '../_tenant/gate';
import SearchLogClient from './searchlog-client';

/**
 * Staff search-history review — server wrapper. Same gating as /admin
 * ('admin' audience): unknown stores 404, suspended/canceled/pending render
 * their status pages (PRD F-7).
 */
export default async function SearchLogPage() {
  const gate = await gateStorePage('admin');
  if (gate.blocked) return gate.blocked;

  return <SearchLogClient />;
}
