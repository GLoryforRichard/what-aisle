import { NextRequest, NextResponse } from 'next/server';
import { getRecentSearches } from '@/lib/ops';
import { requireStore } from '@/lib/store-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = await requireStore(req, { audience: 'staff' });
  if (!gate.ok) return gate.response;
  try {
    const logs = await getRecentSearches(gate.store.slug, 100);
    return NextResponse.json({ ok: true, logs });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
