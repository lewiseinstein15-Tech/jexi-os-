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

/* ARENA (live lesson, Sept 7 2026): pure small talk gets a DETERMINISTIC
   answer — zero model calls, zero provider dependence. The old "one small
   call" flavor died honestly on a day Gemini was 503ing and Groq was
   misbehaving: a "hello" slid the whole provider ladder for a minute.
   Variety comes from rotation pools, not from a model. */
const QUICK_POOLS = {
  identity: QUICK_IDENTITY,
  greeting: [
    'Hey Boss. What are we building today?',
    'Hello, Boss — JEXI online and ready.',
    'Hey! Good to see you. What\'s on your mind?',
    'Habari, Boss. Ready when you are.',
    'Hi Boss — everything\'s running. What do you need?',
  ],
  ack: [
    'Anytime, Boss.',
    'That\'s what I\'m here for.',
    'Good — more where that came from when you need it.',
    'Noted, Boss. Anything else?',
    'Karibu. What\'s next?',
  ],
  bye: [
    'Later, Boss — I\'ll keep everything warm.',
    'See you. Missions keep running while you\'re away.',
    'Goodnight, Boss. I\'ll be here.',
    'Catch you later — the work continues in the background.',
  ],
  howareyou: [
    'Running clean, Boss — all systems green on my side. You?',
    'Better when you\'re around. Everything\'s holding steady — how are you?',
    'Good! Nothing broken, nothing faked. How\'s your day going?',
    'Poa sana, Boss. All quiet — ready for real work when you are.',
  ],
};

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

  if (IDENTITY_RE.test(q)) return { kind: 'smalltalk', sub: 'identity', zeroCall: true };
  if (HOW_ARE_YOU_RE.test(q)) return { kind: 'smalltalk', sub: 'howareyou', zeroCall: true };
  if (GREETING_RE.test(q)) return { kind: 'smalltalk', sub: 'greeting', zeroCall: true };
  if (BYE_RE.test(q)) return { kind: 'smalltalk', sub: 'bye', zeroCall: true };
  if (THANKS_RE.test(q)) return { kind: 'smalltalk', sub: 'ack', zeroCall: true };
  return null;
}

/**
 * Fast path: a DETERMINISTIC pool answer — zero model calls, no planner,
 * no team, no tools, no mission engine. Immune to provider outages.
 */
export async function runFastPath({ query, sub, convId = null, sendEvent = () => {} }) {
  const t0 = Date.now();
  const pool = QUICK_POOLS[sub] || QUICK_POOLS.identity;
  const answer = pool[Math.floor(Math.random() * pool.length)];
  sendEvent('log', { agent: 'JEXI', message: '⚡ Fast path — deterministic answer, zero model calls.' });
  return {
    handled: true,
    answer,
    stats: { fastPath: true, modelCalls: 0, durationMs: Date.now() - t0, deterministic: true, sub },
  };
}

/** Wire the kernel into a chat turn. Returns handled fast-path result or null. */
export async function kernelTurn({ raw, effectiveQuery, convId = null, activeMission = false, sendEvent = () => {} }) {
  const gate = kernelGate(effectiveQuery || raw, { activeMission });
  if (!gate) return null;
  return runFastPath({ query: effectiveQuery || raw, sub: gate.sub, convId, sendEvent });
}
