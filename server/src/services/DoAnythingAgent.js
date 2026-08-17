/**
 * JEXI OS — Do Anything Agent (B89): general-purpose autonomous task agent.
 *
 * "Not just booking — all kinds of things an AI agent should do." This is
 * the free-form agent loop: for ANY task that doesn't fit a fixed pipeline,
 * JEXI plans her own tool-use steps, executes them through the gated
 * ToolRuntime, verifies the outcome, repairs gaps, and reports everywhere.
 *
 *   PLAN    → LLM picks concrete steps from a curated tool catalog
 *             ({ tool, args, why }), bounded to MAX_STEPS.
 *   ACT     → each step runs through executeTool() — the SAME gating as
 *             everything else (permission profiles, risk guard, EXTERNAL
 *             approval). External/risky steps are reported as
 *             "needs-approval" and skipped, never silently run.
 *   VERIFY  → an LLM pass checks the results against the task; missing bits
 *             trigger one repair round (bounded), then a final summary.
 *   REPORT  → structured { success, summary, statistics } for the notifier
 *             (in-app + email + FCM/web push) and the job event stream.
 *
 * Every LLM call is injectable for tests; failures degrade honestly (never
 * a fake success).
 */

import { z } from 'zod';

const MAX_STEPS = 10;
const MAX_REPAIR_ROUNDS = 2;
const MAX_DEADLINE_MS = 10 * 60 * 1000;

/** Curated tool catalog shown to the planner (name + purpose only). */
export const DO_ANYTHING_TOOLS = [
  { slug: 'web-search', desc: 'Search the web for current information' },
  { slug: 'deep-read', desc: 'Read a full page or article from a URL' },
  { slug: 'news-feed', desc: 'Get live news headlines on a topic' },
  { slug: 'wikipedia-lookup', desc: 'Get a trusted overview of a topic' },
  { slug: 'arxiv-search', desc: 'Search academic papers' },
  { slug: 'trusted-library', desc: 'Read free trusted books and papers' },
  { slug: 'pdf-extract', desc: 'Extract text from a PDF at a URL' },
  { slug: 'link-open', desc: 'Open a shared link in the real browser and summarize it' },
  { slug: 'browser-drive', desc: 'Control the real browser: numbered elements, click, type, scroll' },
  { slug: 'screenshot', desc: 'Capture what the browser is showing' },
  { slug: 'vision-analyze', desc: 'Analyze an image (describe, OCR)' },
  { slug: 'video-analyze', desc: 'Watch a video and summarize its content' },
  { slug: 'video-transcript', desc: 'Get a video transcript' },
  { slug: 'memory-recall', desc: 'Recall what JEXI remembers about a topic' },
  { slug: 'memory-write', desc: 'Store a durable fact or preference' },
  { slug: 'semantic-search', desc: 'Semantic search across all memories' },
  { slug: 'knowledge-search', desc: 'Search the saved knowledge library' },
  { slug: 'knowledge-save', desc: 'Save new knowledge to the library' },
  { slug: 'profile-read', desc: 'Read the stored user profile' },
  { slug: 'code-run', desc: 'Run a shell command (time-boxed, sandboxed)' },
  { slug: 'code-write', desc: 'Write a file into the workspace' },
  { slug: 'data-crunch', desc: 'Analyze data rows and columns' },
  { slug: 'stats-compute', desc: 'Compute statistics from data' },
  { slug: 'summarize-doc', desc: 'Summarize a document or text' },
  { slug: 'trend-scan', desc: 'Scan trending topics from feeds' },
  { slug: 'api-call', desc: 'Call an external JSON/REST API' },
  { slug: 'connector-call', desc: 'Send email or GitHub actions — EXTERNAL: needs your approval unless pre-authorized' },
  { slug: 'mcp-call', desc: 'Call an external MCP tool' },
];

const PLAN_SCHEMA = z.object({
  goal: z.string().default(''),
  steps: z.array(z.object({
    tool: z.string(),
    args: z.record(z.unknown()).default({}),
    why: z.string().default(''),
  })).max(MAX_STEPS).default([]),
}).passthrough();

const VERDICT_SCHEMA = z.object({
  complete: z.boolean().default(true),
  missing: z.array(z.string()).default([]),
}).passthrough();

function parseJson(raw) {
  try {
    return JSON.parse(String(raw || '').replace(/```json|```/g, '').trim());
  } catch { return null; }
}

export class DoAnythingAgent {
  /**
   * @param {object} deps
   * @param {function} deps.generateContent — (prompt, system, image, opts) => Promise<string>
   * @param {function} deps.executeTool      — (params) => Promise<result>  (ToolRuntime contract)
   */
  constructor(deps = {}) {
    this.generateContent = deps.generateContent || null;
    this.executeTool = deps.executeTool || null;
  }

  async run({ task, session = 'default', sendEvent = () => {}, opts = {} }) {
    const emit = (t, d) => { try { sendEvent(t, d); } catch { /* noop */ } };
    const started = Date.now();
    const taskText = String(task || '').trim();
    emit('do.start', { task: taskText, session });

    if (!this.generateContent || !this.executeTool) {
      return { success: false, error: 'Do Anything needs AI keys + tool runtime.', summary: '### ⚠ JEXI OS\n\nDo Anything mode needs at least one AI key configured (Settings → Models).' };
    }

    // ── PLAN ──────────────────────────────────────────────────────────────
    let plan = null;
    try {
      const catalog = DO_ANYTHING_TOOLS.map((t) => `- ${t.slug}: ${t.desc}`).join('\n');
      const prompt =
        `You are the planner for an autonomous agent. TASK: "${taskText.slice(0, 1200)}"\n\n` +
        `Available tools:\n${catalog}\n\n` +
        `Plan the fewest concrete steps to complete the task. STRICT JSON only:\n` +
        `{"goal": "one-line restatement", "steps": [{"tool": "slug", "args": {...}, "why": "short reason"}]}\n` +
        `RULES: max ${MAX_STEPS} steps; prefer the smallest number; only use listed tools; ` +
        `args must match the tool's needs (queries, urls, filenames, commands); do NOT invent tools.`;
      const raw = await this.generateContent(prompt, 'You output strict JSON only.', null, { prefer: 'groq', temperature: 0.2 });
      const parsed = parseJson(raw);
      const checked = PLAN_SCHEMA.safeParse(parsed);
      plan = checked.success ? checked.data : null;
    } catch { plan = null; }
    if (!plan || !plan.steps || !plan.steps.length) {
      return { success: false, error: 'could not plan the task', summary: `### ⚠ JEXI OS\n\nI could not form a plan for "${taskText.slice(0, 120)}" right now. Try rephrasing or check your AI keys.` };
    }
    emit('do.plan', { goal: plan.goal, steps: plan.steps.map((s) => s.tool) });

    // ── ACT ───────────────────────────────────────────────────────────────
    const runSteps = async (steps) => {
      const out = [];
      for (const step of steps) {
        if (Date.now() - started > MAX_DEADLINE_MS) { out.push({ step, error: 'deadline' }); break; }
        emit('do.step', { tool: step.tool, args: step.args, why: step.why });
        try {
          const r = await this.executeTool({ slug: step.tool, args: step.args || {}, sendEvent: emit, confirm: async () => false });
          if (r && r.approvalRequired) {
            out.push({ step, needsApproval: true, detail: r.error || 'requires approval' });
            emit('do.step-result', { tool: step.tool, needsApproval: true });
          } else if (r && r.blocked) {
            out.push({ step, blocked: true, error: r.error || 'blocked' });
            emit('do.step-result', { tool: step.tool, blocked: true, error: r.error });
          } else if (r && r.ok) {
            const preview = String(r.result ?? JSON.stringify(r.result ?? '')).slice(0, 600);
            out.push({ step, ok: true, result: preview });
            emit('do.step-result', { tool: step.tool, ok: true, preview: preview.slice(0, 200) });
          } else {
            out.push({ step, error: (r && r.error) || 'failed' });
            emit('do.step-result', { tool: step.tool, error: (r && r.error) || 'failed' });
          }
        } catch (e) {
          out.push({ step, error: (e && e.message) || String(e) });
          emit('do.step-result', { tool: step.tool, error: (e && e.message) || String(e) });
        }
      }
      return out;
    };

    let results = await runSteps(plan.steps);
    let repairs = 0;
    let verifiedComplete = null; // set by the verify pass when it runs

    // ── VERIFY + REPAIR (bounded) ────────────────────────────────────────
    // Verify only when something needs checking (a step failed outright); a
    // clean run is treated as complete without burning an extra LLM call.
    let needsVerify = results.some((r) => r.error && !r.blocked);
    for (let round = 0; round < MAX_REPAIR_ROUNDS && needsVerify; round++) {
      try {
        const digest = results.map((r, i) => `[${i}] ${r.step.tool} → ${r.ok ? 'ok: ' + String(r.result).slice(0, 200) : (r.error || r.detail || 'pending')}`).join('\n');
        const prompt =
          `TASK: "${taskText.slice(0, 800)}"\n\nExecuted steps so far:\n${digest}\n\n` +
          `Is the task complete? STRICT JSON: {"complete": true|false, "missing": ["what is still missing"]}`;
        const raw = await this.generateContent(prompt, 'You output strict JSON only.', null, { prefer: 'groq', temperature: 0.1 });
        const verdict = VERDICT_SCHEMA.safeParse(parseJson(raw));
        if (verdict.success && verdict.data.complete) { verifiedComplete = true; needsVerify = false; break; }
        if (verdict.success) verifiedComplete = false;
        if (!verdict.success || !verdict.data.missing.length) { needsVerify = false; break; }
        emit('do.repair', { round: round + 1, missing: verdict.data.missing });
        const repairPlanRaw = await this.generateContent(
          `TASK: "${taskText.slice(0, 800)}"\nMissing: ${verdict.data.missing.slice(0, 3).join(' | ')}\n` +
          `Pick 1-3 NEW tool steps to fix exactly that. STRICT JSON: {"steps": [{"tool": "slug", "args": {...}, "why": "..."}]}`,
          'You output strict JSON only.', null, { prefer: 'groq', temperature: 0.2 }
        );
        const repairPlan = PLAN_SCHEMA.safeParse(parseJson(repairPlanRaw));
        if (!repairPlan.success || !repairPlan.data.steps.length) { needsVerify = false; break; }
        repairs += 1;
        const extra = await runSteps(repairPlan.data.steps.slice(0, 3));
        results = results.concat(extra);
        needsVerify = results.some((r) => r.error && !r.blocked); // re-verify after repair
      } catch { needsVerify = false; break; }
    }
    if (verifiedComplete === null) verifiedComplete = !results.some((r) => r.error && !r.blocked);

    // ── REPORT ────────────────────────────────────────────────────────────
    const okCount = results.filter((r) => r.ok).length;
    const approvalCount = results.filter((r) => r.needsApproval).length;
    const blockedCount = results.filter((r) => r.blocked).length;
    const failedCount = results.filter((r) => r.error && !r.blocked).length;

    let summary = '';
    try {
      const digest = results.map((r, i) => `[${i}] ${r.step.tool}: ${r.ok ? String(r.result).slice(0, 300) : (r.error || r.detail || '')}`).join('\n');
      const prompt =
        `TASK: "${taskText.slice(0, 800)}"\n\nSteps executed:\n${digest}\n\n` +
        `Write the final report to the user: what was done, the key findings/results, ` +
        `and anything that needs their attention or approval. 2-5 short paragraphs, plain markdown.`;
      summary = String(await this.generateContent(prompt, 'You are JEXI OS, an autonomous agent reporting to its owner.', null, { prefer: 'groq', temperature: 0.4 })).trim();
    } catch { /* fall through */ }
    if (!summary || summary.length < 20) {
      summary = `### 🛠 JEXI OS — TASK COMPLETE\n\nExecuted ${results.length} step(s): ${okCount} succeeded${approvalCount ? `, ${approvalCount} need your approval` : ''}${blockedCount ? `, ${blockedCount} blocked by safety rules` : ''}${failedCount ? `, ${failedCount} failed` : ''}.\n\nCheck the activity log above for details.`;
    }

    // Success = verification confirmed completion (when a verify pass ran)
    // OR no step outright failed; a failed step later compensated by a repair
    // still counts as success once verification is complete.
    const success = okCount > 0 && (verifiedComplete === null ? failedCount === 0 : verifiedComplete === true);
    emit('do.done', { success, summary, statistics: { steps: results.length, ok: okCount, needsApproval: approvalCount, blocked: blockedCount, failed: failedCount, repairs, executionTimeMs: Date.now() - started } });
    return {
      success,
      summary,
      statistics: { steps: results.length, ok: okCount, needsApproval: approvalCount, blocked: blockedCount, failed: failedCount, repairs, executionTimeMs: Date.now() - started },
    };
  }
}

/** Shared singleton wired in index.js. */
export const doAnythingAgent = new DoAnythingAgent();
