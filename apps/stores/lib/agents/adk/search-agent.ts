/**
 * The "find the aisle" agent, built with the Google Agent Development
 * Kit (`@google/adk`).
 *
 * This is the ADK-orchestrated replacement for the legacy hand-rolled pipeline
 * in lib/agents/agent-b.ts. A single LlmAgent drives Gemini function-calling
 * over three app FunctionTools (understand_intent / vector_search /
 * suggest_by_category) wrapping the existing executors. MongoDB access still
 * flows through the MCP layer (lib/mcp/mongo-ops.ts) inside those executors.
 *
 * MULTI-TENANT SECURITY (PRD F-8): the MongoDB MCP server is NO LONGER
 * mounted as an LLM-callable MCPToolset. Native MCP tools take their filter
 * documents from LLM-generated arguments, so they cannot be tenant-scoped —
 * the last remaining allow-listed tool (`count`) let the agent count ANY
 * store's documents with an arbitrary filter. Worse, ADK treats an EMPTY
 * allow-list as "no filter" (see @google/adk mcp_toolset: `filter.length === 0`
 * short-circuits to all tools), so shrinking the list to [] would have exposed
 * find/aggregate/list-collections. Retrieval is app FunctionTools only; each
 * executor injects `store_id` from AsyncLocalStorage (lib/tenant-context.ts).
 *
 * Model + Vertex config mirror lib/gemini.ts exactly (Gemini 3.x is only served
 * from the `global` Vertex location). Constructed lazily as a singleton.
 */
import { ThinkingLevel } from '@google/genai';
import { LlmAgent, Gemini } from '@google/adk';
import { VISION_MODEL } from '@/lib/gemini';
import { ADK_SEARCH_FUNCTION_TOOLS } from './tools';

const INSTRUCTION = `You are the "find the aisle" search orchestrator for a multilingual grocery store. The query may be English, Chinese, Korean, Japanese, mixed, misspelled, or a free description.

Follow EXACTLY this protocol — it is optimized for speed:
1. In your FIRST reply, call BOTH understand_intent(query) AND vector_search(query) — two function calls in the SAME turn, with the raw query.
2. When the results come back:
   - If vector_search returned at least one hit with score ≥ 0.45 → reply with exactly the single word: DONE
   - Otherwise → call suggest_by_category once with the main product or category word, then reply: DONE

Rules:
- You MUST call the tools in step 1 before anything else. Replying DONE without having called vector_search and received its results is a protocol violation — DONE is ONLY valid after tool results have come back.
- vector_search is the ONLY way to locate a product. NEVER browse the database — no list-collections, no find, no count loops; collections like search_logs / search_history will not help.
- NEVER write a prose answer, summary, or translation — the application composes the final bilingual answer itself.`;

/** Gemini model, mirroring lib/gemini.ts: AI Studio when GEMINI_API_KEY is set,
 *  otherwise Vertex AI at the `global` location (required for Gemini 3.x). */
function buildModel(): Gemini {
  const apiKey = process.env.GEMINI_API_KEY;
  return apiKey
    ? new Gemini({ model: VISION_MODEL, apiKey })
    : new Gemini({
        model: VISION_MODEL,
        vertexai: true,
        project: process.env.GOOGLE_CLOUD_PROJECT,
        location: 'global',
      });
}

let _agent: LlmAgent | null = null;

/** Lazily-built singleton search agent. */
export function getSearchAgent(): LlmAgent {
  if (_agent) return _agent;
  _agent = new LlmAgent({
    name: 'whataisle_search_agent',
    model: buildModel(),
    description: 'Finds which supermarket aisle a product is on, across languages.',
    instruction: INSTRUCTION,
    // App FunctionTools ONLY — no native MCP tools (see tenant-security note above).
    tools: [...ADK_SEARCH_FUNCTION_TOOLS],
    generateContentConfig: {
      temperature: 0.2,
      // Tool routing is pattern work, not reasoning. Leaving thinking ON was
      // costing 2-12 s PER agent turn on gemini-3.5-flash (dynamic thinking).
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    },
  });
  return _agent;
}
