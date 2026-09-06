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
import { parseModelJson } from './JsonRepair.js'; // B209 — salvage sloppy-but-complete model JSON
import { executeTool } from '../ToolRuntime.js';

/** Extract the first JSON object from model text — B209: through the
 * repair parser (models wrap JSON in prose AND pollute values with markdown
 * bold / raw newlines; the strict parser declined whole Director turns). */
function extractJson(text) {
  return parseModelJson(text);
}

const INTERPRET_SYSTEM = `You are JEXI — the boss of a team of AI employees (research, engineering, verification, security, planning, memory, data, design). A message from your user (Lewis) arrives. Your job is to interpret it like a strong chief of staff would and output the internal work order.

Rules:
- The user may be vague, informal, or terse ("fix this", "make it good", "login", "why broken"). NEVER complain about vagueness. Infer the most probable intent from the message and any context; state your assumptions explicitly.
- Reconstruct a proper professional objective (what "better"/"good"/"this" most plausibly means here), with measurable success criteria.
- Ask a clarifying question ONLY if the request is genuinely unresolvable AND acting on a wrong guess would be destructive/risky. Otherwise proceed with assumptions.
- Decide the minimal team: simple requests get ONE subtask; only genuinely multi-part work gets up to 5. NEVER pad the plan.
- Each subtask gets capability requirements from this vocabulary ONLY: code, research, search, synthesis, verification, security, planning, memory, data, design, reasoning, computer. Use the computer capability only when the work needs a REAL browser (opening a page, clicking, reading live content).
- Subtasks that need fresh facts from the web get searchQueries (1-3 precise queries). Pure reasoning/knowledge work gets none.
- If the objective is a full application/website BUILD, set taskType "build" and give exactly ONE subtask with "department": "build" (the engineering department handles it end-to-end).
- B215 structured objective fields: "desiredOutcome" = the concrete end-state the user wants (distinct from the internal objective phrasing); "unknowns" = ONLY genuine open questions that could materially change the result (empty array if none — never invent doubts); "requiredArtifacts" = the concrete deliverables expected (files, apps, reports — empty array if none).
- Writing, running, and testing code is ONE code-capability subtask (the engineer can execute allowlisted commands inside her own assignment). NEVER split "then run/execute/test it" into a separate subtask for another employee — only the code engineer can actually execute, and a non-executor claiming results is fabrication.
- userLine is what you say to Lewis in your own voice (1-2 sentences, confident boss energy, varied phrasing, never "Sure!" / "Of course!"). It must state what you understood and what you're doing — but NEVER state the answer or result itself before the team has actually done the work.
- formatHint is how the final answer should read: one of concise-answer, executive-summary, bullets, steps, table, code, before-after, decision, work-report, team-delivery, verification-report, warning, action-list, technical-report.

Output ONLY JSON:
{"understood":"one line","refinedObjective":"the proper internal objective","desiredOutcome":"the concrete end-state the user wants","userLine":"what you say to the user","assumptions":["..."],"unknowns":["only genuine open questions — [] if none"],"requiredArtifacts":["concrete deliverables expected — [] if none"],"ambiguity":"low|medium|high","clarifyingQuestion":"only when needed","risky":false,"taskType":"conversational|factual|research|code|data|design|planning|security|verification|synthesis|build","complexity":"simple|standard|complex","constraints":["..."],"successCriteria":["..."],"formatHint":"...","needsVerification":true,"subtasks":[{"title":"...","details":"precise professional instructions","capability":"research","requirements":["research","search"],"dependsOn":[],"searchQueries":["..."],"expectedOutput":"...","priority":"normal"}]}`;

export function realLlmAdapter() {
  return {
    interpret: async ({ raw, effectiveQuery, contextBlock, memoryContext, activeTaskId, image, failureContext }) => {
      // CAPABILITY ROUTER (§7/§11): the minimum useful live services for THIS
      // message become an explicit menu — the interpreter may attach real
      // mcpCalls to a subtask; the employee session executes them for real.
      let mcpMenu = '';
      try {
        const { selectMcpToolset } = await import('../CapabilityRouter.js');
        const sel = selectMcpToolset(String(effectiveQuery || raw || ''), { intent: null });
        if (sel.schemas.length) {
          mcpMenu = `# AVAILABLE LIVE SERVICES (capability-routed for this exact request)\n${sel.schemas.map((sc) => {
            const name = sc.function.name.replace(/^mcp__/, '').replace('__', ' · ');
            const argSpec = Object.entries(sc.function.parameters.properties || {})
              .map(([k, v]) => `${k}${v.type === 'number' ? ':number' : ''}${Array.isArray(sc.function.parameters.required) && sc.function.parameters.required.includes(k) ? ' (required)' : ''}`)
              .join(', ');
            return `- ${name}${argSpec ? ` — args: ${argSpec}` : ''}`;
          }).join('\n')}\nPrefer the SIMPLEST SINGLE call that answers the question (e.g. weather: get_weather_summary with city_name — NOT search_location plus a second call). If (and only if) a subtask needs this live data, give it "mcpCalls":[{"server":"<name>","tool":"<tool>","args":{...}}] (max 3). Only use services from the list above. Data from these services is REAL — prefer it over web search for its domain.`;
        }
      } catch { /* routing is additive — interpretation works without it */ }
      const user = [
        `# USER MESSAGE (verbatim)\n"${String(raw || '').slice(0, 2000)}"`,
        contextBlock ? `# CONVERSATION/TASK CONTEXT\n${String(contextBlock).slice(0, 2500)}` : '',
        memoryContext ? `# WHAT WE ALREADY KNOW (memory)\n${String(memoryContext).slice(0, 1500)}` : '',
        mcpMenu || '',
        activeTaskId ? `# NOTE: there is an active product task in progress — "fix/change/add" language usually means modifying THAT, not starting new research.` : '',
        failureContext ? `# REPLAN — the previous attempt failed; produce a genuinely different plan\n${String(failureContext).slice(0, 2000)}` : '',
      ].filter(Boolean).join('\n\n');
      let parsed = extractJson(await generateContent(user, INTERPRET_SYSTEM, image || null, {}));
      // B209 — a lane that answers WITHOUT JSON is as bad as a failed lane
      // (refusals, empty bodies, degraded free-tier responses): retry on
      // other lanes before declining the turn. The Director's honesty
      // backstop stays, but it should only fire when the lanes truly have
      // nothing usable.
      if (!parsed) {
        for (const alt of ['openrouter', 'groq', 'deepinfra', 'cerebras']) {
          try {
            parsed = extractJson(await generateContent(user, INTERPRET_SYSTEM, image || null, { prefer: alt }));
            if (parsed) break;
          } catch { /* next lane */ }
        }
      }
      return parsed;
    },

    employee: async ({ system, user, prefer, onToken }) =>
      generateContent(user, system, null, { prefer: prefer || undefined, ...(onToken ? { onToken } : {}) }),

    verify: async ({ system, user, prefer }) =>
      generateContent(user, system, null, { prefer: prefer || undefined }),

    report: async ({ system, user, onToken }) =>
      generateContent(user, system, null, { ...(onToken ? { onToken } : {}) }),

    // B209 — the SUPERVISION CHECKPOINT REVIEW: a cheap, focused look at the
    // employee's draft ~600 chars in. JSON verdict only; no prose.
    review: async ({ objective, criteria, draft, employeeName }) => {
      const system = `You are a supervisor reviewing an employee's in-progress draft about 600 characters into their work. Decide ONLY if the approach is clearly off-track for the objective (wrong deliverable, misunderstanding the task, refusing, or drifting). Normal drafts pass. Respond with JSON only: {"redirect": true|false, "reason": "short", "instruction": "if redirect, what to do instead"}`;
      const user = `# OBJECTIVE\n${String(objective || '').slice(0, 400)}\n\n# SUCCESS CRITERIA\n${(criteria || []).slice(0, 4).map((c) => `- ${c}`).join('\n') || '- not specified'}\n\n# EMPLOYEE\n${employeeName || 'employee'}\n\n# DRAFT SO FAR\n${String(draft || '').slice(0, 1200)}`;
      const raw = await generateContent(user, system, null, { prefer: 'flash' });
      try {
        const m = String(raw).match(/\{[\s\S]*\}/);
        const parsed = m ? JSON.parse(m[0]) : {};
        return {
          redirect: parsed.redirect === true,
          reason: String(parsed.reason || 'off-track approach').slice(0, 160),
          instruction: String(parsed.instruction || 'restart with a correct approach for the objective').slice(0, 400),
        };
      } catch {
        return { redirect: false, reason: '', instruction: '' }; // a bad review never breaks the run
      }
    },
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
