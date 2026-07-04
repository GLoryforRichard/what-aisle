import { NextRequest, NextResponse } from 'next/server';
import { setSearchFeedback, SearchFeedback } from '@/lib/ops';
import { requireStore } from '@/lib/store-context';

export const runtime = 'nodejs';

/**
 * POST /api/search/feedback — a worker rates a finished search.
 * Body: { id, feedback } where feedback is
 *   { verdict: 'correct', product: '<canonical_name>' } | { verdict: 'wrong' } | null
 * `id` is the search_history row id sent to the client via the SSE `logged` event.
 */
export async function POST(req: NextRequest) {
  const gate = await requireStore(req);
  if (!gate.ok) return gate.response;
  try {
    const body = (await req.json()) as { id?: string; feedback?: SearchFeedback };
    const id = (body.id || '').trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    }
    const ok = await setSearchFeedback(gate.store.slug, id, body.feedback ?? null);
    return NextResponse.json({ ok });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
