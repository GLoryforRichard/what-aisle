import { NextRequest } from 'next/server';
import { runAgentB } from '@/lib/agents/agent-b';
import { runAgentBAdk } from '@/lib/agents/adk/run-search';
import { logOp, logSearchHistory } from '@/lib/ops';
import { requireStore } from '@/lib/store-context';
import { runWithTenant } from '@/lib/tenant-context';
import { EMPTY_USAGE, addUsage, UsageTotals } from '@/lib/cost';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface SearchBody {
  query: string;
}

export async function POST(req: NextRequest) {
  // Tenant resolution FIRST (PRD F-8): the whole agent run below executes
  // inside runWithTenant(store.slug), which is where the vector/text search
  // executors pick up their store_id filter. The LLM never sees the tenant.
  const gate = await requireStore(req);
  if (!gate.ok) return gate.response;
  const store = gate.store;

  const body = (await req.json()) as SearchBody;
  const query = body.query?.trim();

  if (!query) {
    return new Response(
      JSON.stringify({ ok: false, error: 'query is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      // AsyncLocalStorage context must be entered INSIDE start() — the stream
      // body runs outside the POST handler's async scope.
      await runWithTenant(store.slug, async () => {
        let usage: UsageTotals = { ...EMPTY_USAGE };
        let doneData: Record<string, unknown> | null = null;
        try {
          // Default to the ADK-orchestrated agent (Gemini function-calling).
          // SEARCH_ENGINE=legacy flips back to the original hand-rolled
          // pipeline as a one-line rollback.
          const runSearch =
            process.env.SEARCH_ENGINE === 'legacy' ? runAgentB : runAgentBAdk;
          for await (const event of runSearch({ query })) {
            const e = event as { type?: string; usage?: Partial<UsageTotals>; data?: Record<string, unknown> };
            if (e.type === 'cost' && e.usage) usage = addUsage(usage, e.usage);
            if (e.type === 'done' && e.data) doneData = e.data;
            send(event);
          }
          await logOp(store.slug, 'search', usage);
          const historyId = await logSearchHistory(store.slug, query, doneData);
          if (historyId) send({ type: 'logged', ts: Date.now(), historyId });
        } catch (err) {
          send({
            type: 'error',
            ts: Date.now(),
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          controller.close();
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
