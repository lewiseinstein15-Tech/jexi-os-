/**
 * B208 — REAL ADAPTERS: the production wiring of the Director to JEXI's
 * actual infrastructure. The Director takes these as injected seams so tests
 * can run the full orchestration deterministically; in production these are
 * the real thing:
 *
 *   llm.interpret  → generateContent (schema-prompted JSON, validated)
 *   llm.employee   → generateContent with the ModelRouter's `prefer`
 *   llm.verify     → generateContent (rubric JSON)
 *   llm.report     → generateContent (streams tokens to the user)
 *   tools.search   → executeTool('web-search') — the real search runtime
 */

import { generateContent } from '../LLMClient.js';
import { executeTool } from '../ToolRuntime.js';

/** Extract the first JSON object from model text (models wrap JSON in prose). */
function extractJson(text) {
  const t = String(text || '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

const INTERPRET_SYSTEM = `You are JEXI — the boss of a team of AI employees (research, engineering, verification, security, planning, memory, data, design). A message from your user (Lewis) arrives. Your job is to interpret it like a strong chief of staff would and output the internal work order.

Rules:
- The user may be vague, informal, or terse ("fix this", "make it good", "login", "why broken"). NEVER complain about vagueness. Infer the most probable intent from the message and any context; state your assumptions explicitly.
- Reconstruct a proper professional objective (what "better"/"good"/"this" most plausibly means here), with measurable success criteria.
- Ask a clarifying question ONLY if the request is genuinely unresolvable AND acting on a wrong guess would be destructive/risky. Otherwise proceed with assumptions.
- Decide the minimal team: simple requests get ONE subtask; only genuinely multi-part work gets up to 5. NEVER pad the plan.
- Each subtask gets capability requirements from this vocabulary ONLY: code, research, search, synthesis, verification, security, planning, memory, data, design, reasoning.
- Subtasks that need fresh facts from the web get searchQueries (1-3 precise queries). Pure reasoning/knowledge work gets none.
- If the objective is a full application/website BUILD, set taskType "build" and give exactly ONE subtask with "department": "build" (the engineering department handles it end-to-end).
- userLine is what you say to Lewis in your own voice (1-2 sentences, confident boss energy, varied phrasing, never "Sure!" / "Of course!"). It must state what you understood and what you're doing — but NEVER state the answer or result itself before the team has actually done the work.
- formatHint is how the final answer should read: one of concise-answer, executive-summary, bullets, steps, table, code, before-after, decision, work-report, team-delivery, verification-report, warning, action-list, technical-report.

Output ONLY JSON:
{"understood":"one line","refinedObjective":"the proper internal objective","userLine":"what you say to the user","assumptions":["..."],"ambiguity":"low|medium|high","clarifyingQuestion":"only when needed","risky":false,"taskType":"conversational|factual|research|code|data|design|planning|security|verification|synthesis|build","complexity":"simple|standard|complex","constraints":["..."],"successCriteria":["..."],"formatHint":"...","needsVerification":true,"subtasks":[{"title":"...","details":"precise professional instructions","capability":"research","requirements":["research","search"],"dependsOn":[],"searchQueries":["..."],"expectedOutput":"...","priority":"normal"}]}`;

export function realLlmAdapter() {
  return {
    interpret: async ({ raw, effectiveQuery, contextBlock, memoryContext, activeTaskId, image, failureContext }) => {
      const user = [
        `# USER MESSAGE (verbatim)\n"${String(raw || '').slice(0, 2000)}"`,
        contextBlock ? `# CONVERSATION/TASK CONTEXT\n${String(contextBlock).slice(0, 2500)}` : '',
        memoryContext ? `# WHAT WE ALREADY KNOW (memory)\n${String(memoryContext).slice(0, 1500)}` : '',
        activeTaskId ? `# NOTE: there is an active product task in progress — "fix/change/add" language usually means modifying THAT, not starting new research.` : '',
        failureContext ? `# REPLAN — the previous attempt failed; produce a genuinely different plan\n${String(failureContext).slice(0, 2000)}` : '',
      ].filter(Boolean).join('\n\n');
      const text = await generateContent(user, INTERPRET_SYSTEM, image || null, {});
      return extractJson(text);
    },

    employee: async ({ system, user, prefer, onToken }) =>
      generateContent(user, system, null, { prefer: prefer || undefined, ...(onToken ? { onToken } : {}) }),

    verify: async ({ system, user, prefer }) =>
      generateContent(user, system, null, { prefer: prefer || undefined }),

    report: async ({ system, user, onToken }) =>
      generateContent(user, system, null, { ...(onToken ? { onToken } : {}) }),
  };
}

export function realTools() {
  return {
    search: async (query) => {
      const r = await executeTool({ slug: 'web-search', args: { query } });
      if (!r || (!r.ok && r.error)) throw new Error(String(r.error || 'search failed').slice(0, 120));
      return typeof r.result === 'string' ? r.result : JSON.stringify(r.result ?? r.output ?? '');
    },
  };
}
