/**
 * JEXI EXECUTIVE KERNEL — Arena rebuild Phase 1 (spec Part 2/3/4).
 *
 * ONE software control layer in front of every chat turn. Deterministic
 * first: small talk, identity questions and simple commands are answered
 * with ZERO pipeline stages — one small model call at most, never the
 * planner→router→agent→synthesizer chain.
 *
 *   USER → KERNEL (deterministic gate)
 *        → FAST PATH  (small talk: 1 small call, done)
 *        → LANES      (mission → director → planner pipeline, as before)
 *
 * The kernel also owns per-request model-call accounting (spec Part 3):
 * every stage reports into the request meter and the final answer carries
 * honest numbers — modelCalls, latency per stage — so speed is measured,
 * not guessed.
 *
 * Model-agnostic: the fast path goes through the same LLMClient provider
 * ladder (free remote providers by default; an Ollama endpoint can be
 * configured via env — Phase 1 adds OllamaProvider to the ladder).
 */
import { generateContent } from './LLMClient.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';

/* ── request meter (spec Part 3: know exactly what a turn cost) ──────────── */
const meters = new Map(); // meterId → { t0, stages: [], modelCalls: [] }

export function startMeter(label = 'turn') {
  const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  meters.set(id, { label, t0: Date.now(), stages: [], modelCalls: [] });
  if (meters.size > 200) { // bounded
    const oldest = meters.keys().next().value;
    meters.delete(oldest);
  }
  return id;
}

export function meterStage(meterId, stage, ms, modelCalls = 0) {
  const m = meters.get(meterId);
  if (!m) return;
  m.stages.push({ stage, ms, modelCalls });
  for (let i = 0; i < Number(modelCalls) || 0; i++) m.modelCalls.push(stage);
}

export function meterModelCall(meterId, stage) {
  const m = meters.get(meterId);
  if (m) m.modelCalls.push(stage);
}

export function meterReport(meterId) {
  const m = meters.get(meterId);
  if (!m) return null;
  const totalMs = Date.now() - m.t0;
  const byStage = {};
  for (const s of m.stages) byStage[s.stage] = (byStage[s.stage] || 0) + s.ms;
  return {
    totalMs,
    modelCalls: m.modelCalls.length,
    modelCallStages: m.modelCalls,
    stages: byStage,
  };
}

/* ── deterministic gate (spec Part 3: know when NOT to use the pipeline) ─── */

const GREETING_RE = /^(hi|hello|hey|yo|howdy|sup|hola|habari|good (morning|afternoon|evening)|whats up|what's up|wassup|mambo|niaje)\b[\s.!?,\w']{0,30}$/i;
const THANKS_RE = /^(thanks|thank you|thx|ty|asante|shukran|appreciate it|nice one|perfect|great|cool|ok|okay|got it|sounds good|alright)\b[\s.!\w']{0,20}$/i;
const BYE_RE = /^(bye|goodbye|see you|see ya|later|good night|gn|night night|catch you later)\b[\s.!\w']{0,20}$/i;
const IDENTITY_RE = /^(who are you|who built you|what are you|what'?s your name|are you (an )?ai|who made you|introduce yourself)\b[\s.?\w']{0,30}$/i;
const HOW_ARE_YOU_RE = /^(how are you|how'?s it going|how are things|you good|how you doing|uko poa|umekuwaje)\b[\s.?\w']{0,30}$/i;

/** Zero-pipeline quick answers (deterministic, honest, varied). */
const QUICK_IDENTITY = [
  'I\'m JEXI — your executive AI. You built me, Boss. What are we building today?',
  'JEXI. Lewis built me — I run your systems, plans and tools so you don\'t have to.',
  'I\'m JEXI, your AI executive partner. One boss: you. One job: get things done.',
];

/** Small talk that earns ONE small model call (personality, not pipeline). */
const SMALLTALK_RE = new RegExp(
  `^(${GREETING_RE.source.replace(/^\^|\$$/g, '')}|${THANKS_RE.source.replace(/^\^|\$$/g, '')}|${BYE_RE.source.replace(/^\^|\$$/g, '')}|${HOW_ARE_YOU_RE.source.replace(/^\^|\$$/g, '')}|haha+|lol+|nice|awesome|wow)[\\s.!?,]*$`,
  'i',
);

/**
 * The kernel gate. Returns a handled fast-path turn, or null to pass to lanes.
 * Pure decision, zero model calls — the model only runs inside runFastPath.
 */
export function kernelGate(raw, { activeMission = false } = {}) {
  const q = String(raw || '').trim();
  if (!q || q.length > 200) return null; // long messages are never small talk

  // an ACTIVE mission gets steering priority — the kernel never intercepts
  if (activeMission) return null;

  if (IDENTITY_RE.test(q) || HOW_ARE_YOU_RE.test(q)) {
    return { kind: 'smalltalk', sub: 'identity', zeroCall: false };
  }
  if (GREETING_RE.test(q)) return { kind: 'smalltalk', sub: 'greeting', zeroCall: false };
  if (THANKS_RE.test(q) || BYE_RE.test(q)) {
    // acknowledgements are the closest to zero-call we honestly get
    return { kind: 'smalltalk', sub: 'ack', zeroCall: false };
  }
  return null;
}

/**
 * Fast path: ONE small model call with a tight prompt — personality + the
 * last message only. No planner, no team, no tools, no mission engine.
 */
export async function runFastPath({ query, sub, convId = null, sendEvent = () => {} }) {
  const t0 = Date.now();
  // personality core from the real identity prompt (first section only —
  // identity + voice, no pipeline instructions: this is the FAST path)
  const personaCore = JEXI_SYSTEM_PROMPT.split(/\n(?=\S)/).slice(0, 6).join('\n');
  const system = `${personaCore}

You are answering ONE quick ${sub} message from Lewis (your creator — call him "Boss" when natural, mirror his energy: playful when he's playful, professional when he's serious).
Rules:
- 1-2 short sentences MAX. This is small talk, not a briefing.
- Never offer a giant menu of options. Never say "Sure!" or "How can I help you today?".
- If he thanked you: warm, brief, no fluff. If he said bye: warm goodbye, one line.
- Be real. No emoji spam (one emoji is fine when it fits).`;
  try {
    sendEvent('log', { agent: 'JEXI', message: '⚡ Fast path — no pipeline, one quick call.' });
    const answer = await generateContent(`Lewis: ${query}`, system, null, { temperature: 0.8, maxTokens: 120 });
    const text = String(answer || '').trim();
    if (text) {
      return { handled: true, answer: text, stats: { fastPath: true, modelCalls: 1, durationMs: Date.now() - t0 } };
    }
  } catch { /* fall through to lanes honestly */ }
  // honest deterministic fallback if the quick call failed — still no pipeline
  const fallback = QUICK_IDENTITY[Math.floor(Math.random() * QUICK_IDENTITY.length)];
  return { handled: true, answer: fallback, stats: { fastPath: true, modelCalls: 0, durationMs: Date.now() - t0, note: 'quick call failed — deterministic fallback' } };
}

/** Wire the kernel into a chat turn. Returns handled fast-path result or null. */
export async function kernelTurn({ raw, effectiveQuery, convId = null, activeMission = false, sendEvent = () => {} }) {
  const gate = kernelGate(effectiveQuery || raw, { activeMission });
  if (!gate) return null;
  return runFastPath({ query: effectiveQuery || raw, sub: gate.sub, convId, sendEvent });
}
