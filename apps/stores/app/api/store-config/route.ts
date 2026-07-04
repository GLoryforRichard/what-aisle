import { NextRequest, NextResponse } from 'next/server';
import { requireStore } from '@/lib/store-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public, safe-fields-only store configuration for client components
 * (shelf pickers, floorplan, branding). No billing / admin / video fields.
 */
export async function GET(req: NextRequest) {
  const gate = await requireStore(req);
  if (!gate.ok) return gate.response;
  const s = gate.store;

  return NextResponse.json({
    ok: true,
    slug: s.slug,
    name: s.name,
    name_zh: s.name_zh ?? null,
    branding: s.branding,
    shelves: s.shelves,
    floorplan: s.floorplan,
  });
}
