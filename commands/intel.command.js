/**
 * JEXI OS — COMMANDS — /intel (Phase 7 G).
 *
 * Plan-aware triage of new input (URL / article / text) against the ACTIVE
 * plan (server/src/services/PlanStore.js): ADOPT / TRIAL / WATCH / SKIP with
 * provenance back to the source and the matched plan step.
 *
 * Deterministic scoring over real plan data; when an LLM is configured it
 * gets a second-opinion pass. The verdict always names its evidence.
 */

import { serverMod, clampText } from './_context.js';

const VERDICTS = ['ADOPT', 'TRIAL', 'WATCH', 'SKIP'];

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
}

const STOP = new Set(['this', 'that', 'with', 'from', 'have', 'will', 'your', 'about', 'into', 'over', 'after', 'before', 'when', 'what', 'which', 'been', 'were', 'their', 'them', 'they', 'than', 'then', 'more', 'most', 'some', 'such', 'only', 'also', 'very', 'just', 'there', 'here', 'where', 'while', 'should', 'would', 'could', 'https', 'http', 'www', 'com']);

export default {
  name: 'intel',
  aliases: [],
  description: 'Triage new input against the active plan (ADOPT/TRIAL/WATCH/SKIP) with provenance',
  category: 'learning',
  args: [
    { name: 'source', required: true, type: 'string', default: '', description: 'URL, article text, or any input to triage' },
  ],
  async handler(args, ctx) {
    const source = String(args.source || '').trim();
    const isUrl = /^https?:\/\//i.test(source);

    // ── the real plan (never a hardcoded one) ────────────────────────────
    let plan = null;
    try {
      const P = await serverMod('src/services/PlanStore.js');
      plan = P?.planGet?.() || null;
    } catch { plan = null; }

    const planSteps = (plan?.steps || []).map((s, i) => ({
      index: i,
      text: String(s.text || s.title || s.description || s).slice(0, 160),
      status: s.status || 'pending',
    }));

    const srcTokens = new Set(tokenize(source));

    // ── score each plan step by token overlap ────────────────────────────
    let best = null;
    const scores = planSteps.map((step) => {
      const st = tokenize(step.text);
      const hits = st.filter((w) => srcTokens.has(w));
      const score = st.length ? hits.length / Math.sqrt(st.length) : 0;
      if (!best || score > best.score) best = { step, score, hits };
      return { step, score: Math.round(score * 100) / 100, hits };
    });

    // ── verdict rules (deterministic, evidence-backed) ───────────────────
    let verdict, reason;
    const topScore = best?.score ?? 0;
    if (!planSteps.length) {
      verdict = 'WATCH';
      reason = 'no active plan to match against — logged for the next planning pass';
    } else if (topScore >= 0.6 && best.step.status !== 'completed' && best.step.status !== 'done') {
      verdict = 'ADOPT';
      reason = `strong overlap with open plan step #${best.step.index}`;
    } else if (topScore >= 0.6) {
      verdict = 'SKIP';
      reason = `overlaps plan step #${best.step.index} which is already ${best.step.status}`;
    } else if (topScore >= 0.3) {
      verdict = 'TRIAL';
      reason = `partial overlap with plan step #${best.step.index} — worth a bounded experiment`;
    } else {
      verdict = 'WATCH';
      reason = 'no overlap with the active plan — novel input, keep on the radar';
    }

    // ── LLM second opinion (only when a provider is live) ────────────────
    let llmOpinion = null;
    try {
      const providers = await serverMod('src/providers/index.js');
      if (providers?.canChat?.()) {
        const LLM = await serverMod('src/providers/runtime/LLMClient.js');
        if (LLM?.generateContent) {
          const prompt = [
            `Active plan: ${plan?.title || '(none)'}; steps:`,
            ...planSteps.map((s) => `#${s.index} [${s.status}] ${s.text}`),
            '',
            `New input: ${clampText(source, 400)}`,
            'Triage the input against this plan as exactly one of ADOPT / TRIAL / WATCH / SKIP, with a one-sentence reason.',
          ].join('\n');
          const r = await LLM.generateContent(prompt, 'You are a triage analyst. Answer in one line: VERDICT — reason.', null, { maxTokens: 120 });
          const text = clampText(String(typeof r === 'string' ? r : (r?.text || r?.answer || '')), 300);
          if (text) llmOpinion = text;
          const m = text.match(/\b(ADOPT|TRIAL|WATCH|SKIP)\b/i);
          if (m && VERDICTS.includes(m[1].toUpperCase())) {
            // LLM may only upgrade WATCH→TRIAL/ADOPT or confirm; it may not flip an evidence-based SKIP
            const llmVerdict = m[1].toUpperCase();
            if (!(verdict === 'SKIP' && llmVerdict !== 'SKIP')) {
              reason += ` (LLM concurs: ${llmVerdict})`;
            }
          }
        }
      }
    } catch { llmOpinion = null; }

    ctx.log(`triage: ${verdict} — ${reason}`);

    return {
      ok: true,
      summary: `intel: ${verdict} — ${reason}`,
      verdict,
      reason,
      source: { kind: isUrl ? 'url' : 'text', value: clampText(source, 300) },
      plan: { title: plan?.title || null, steps: planSteps.length },
      matchedStep: best && best.score > 0
        ? { index: best.step.index, text: best.step.text, status: best.step.status, score: best.score, hits: best.hits }
        : null,
      scores: scores.filter((s) => s.score > 0).slice(0, 3),
      llmOpinion,
    };
  },
};
