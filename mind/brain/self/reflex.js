/**
 * JEXI OS — Phase 31 Scope 19 — brain/self/reflex.js
 *
 * Orchestration reflex for questions that are NOT about JEXI herself.
 * The user speaks to JEXI; the user never speaks to an agent. This module
 * is a BEHAVIOUR over injected seams (model + search + dispatch) — it does
 * not implement search, models or dispatch itself and pulls in no server
 * module. The bootstrap injects the real seams; probes inject fakes.
 *
 *   createReflex({ model, search, dispatch, now }) -> { route, run, refine, needsVerification }
 *
 * Flow (run):
 *   1. classify            self-question -> composer (caller handles); task -> bucket 3
 *   2. refine              silently rewrite the user's words into a search-grade prompt
 *   3. harness             provider model first pass (via `model`)
 *   4. verify (conditional) factual/current/ambiguous -> `search(refinedPrompt)` -> evidence
 *   5. check               model answer vs evidence (date + entity overlap)
 *   6. answer              one answer out; agent names never surface
 *
 * Every trace records what happened for the probe, but `answer` never names
 * an agent. "I found…" not "the search agent found…".
 * Error class: SemanticaError (reused).
 */
import { SemanticaError } from '../../../services/semantica/_internal.js';
import { classify } from './composer.js';

const fail = (code, message, details = {}) => Object.assign(new SemanticaError(code, message), details);

/* ---------------- classification -------------------------------------- */
const TASK_RE = /^\s*(?:please\s+)?(?:build|create|make|write|code|implement|set ?up|deploy|automate|design|generate|draft|scaffold|fix|refactor|schedule|remind|book|send|run|install|configure)\b/i;
const SIMPLE_RE = /^\s*(?:hi|hello|hey|thanks|thank you|ok|okay|cool|nice|lol|good (?:morning|night|evening))\b|^\s*[-+*/().\d\s^%=]+\??\s*$|\b(?:what is|calculate|compute|solve)\b[^?]*\b\d+\s*[-+*/^%]\s*\d+/i;
const CODING_RE = /\b(?:regex|function|class|javascript|python|typescript|sql|bash|compile|syntax|stack ?trace|error:)\b/i;
const CURRENT_RE = /\b(?:current|currently|latest|now|today|this (?:year|month|week)|recent|newest|202\d|price|score|weather|president|prime minister|ceo|governor|champion|winner|release date|who is the|who's the|how many .* (?:now|today))\b/i;
const FACTUAL_RE = /^\s*(?:who|what|when|where|which|how (?:many|much|old|far|long)|is|are|was|were|does|did|do)\b/i;

export function route(question) {
  const q = String(question || '');
  const selfTopic = classify(q);
  if (selfTopic) return { bucket: selfTopic === 'lewis' || selfTopic === 'source' || selfTopic === 'replicate' ? 2 : 1, kind: 'self', topic: selfTopic };
  if (TASK_RE.test(q)) return { bucket: 3, kind: 'task' };
  return { bucket: 3, kind: 'question' };
}

export function needsVerification(question) {
  const q = String(question || '');
  if (SIMPLE_RE.test(q) || CODING_RE.test(q)) return { verify: false, reason: 'simple/chat/math/coding — harness only' };
  if (CURRENT_RE.test(q)) return { verify: true, reason: 'factual + current' };
  if (FACTUAL_RE.test(q)) return { verify: true, reason: 'factual' };
  if (/\?\s*$/.test(q) && q.split(/\s+/).length <= 6) return { verify: true, reason: 'ambiguous short question' };
  return { verify: false, reason: 'conversational — harness only' };
}

/** Silent refinement: user's literal words -> search-grade prompt. Deterministic, no model. */
export function refine(question, { now = new Date() } = {}) {
  let q = String(question || '').trim().replace(/\s+/g, ' ');
  const year = new Date(now).getUTCFullYear();
  q = q.replace(/^(?:hey|hi|yo|please|pls|can you|could you|tell me|do you know|i want to know|quick question)[,:\s]+/i, '');
  q = q.replace(/\?+$/, '').trim();
  const current = CURRENT_RE.test(q);
  const refined = current && !/\b20\d{2}\b/.test(q) ? `${q} (as of ${year}, latest official source)` : q;
  return { refined, current, year };
}

/* ---------------- evidence check ---------------------------------------- */
const tokens = (s) => new Set(String(s || '').toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || []);

export function checkAgainstEvidence(modelAnswer, evidence = []) {
  const ev = Array.isArray(evidence) ? evidence : [];
  if (!ev.length) return { agrees: null, reason: 'no evidence returned', support: 0 };
  const a = tokens(modelAnswer);
  let support = 0;
  for (const e of ev) {
    const t = tokens(`${e.title || ''} ${e.quote || e.snippet || ''}`);
    let hit = 0; for (const w of a) if (t.has(w)) hit += 1;
    if (a.size && hit / a.size >= 0.25) support += 1;
  }
  return { agrees: support > 0, reason: support ? `${support}/${ev.length} sources support the first pass` : 'first pass unsupported by evidence', support };
}

/* ---------------- surface-name scrubber -------------------------------- */
const AGENT_NAME_RE = /\b(?:the\s+)?(?:search|research(?:er)?|web|browser|coding|planner|verifier|memory)\s+agent\b[^.]*?\b(?:found|says|reports|returned|discovered)\b/gi;
export function scrub(text) {
  return String(text || '').replace(AGENT_NAME_RE, 'I found').replace(/\bmy (?:search|research) agent\b/gi, 'I');
}

/* ---------------- the reflex --------------------------------------------- */
/**
 * @param {object} seams
 * @param {(prompt:string)=>Promise<string>|string} seams.model     provider first pass
 * @param {(prompt:string)=>Promise<Array<{url:string,title?:string,quote?:string,date?:string}>>} seams.search  evidence
 * @param {(task:string)=>Promise<object>|object} [seams.dispatch] workforce dispatch for bucket 3 tasks
 * @param {Date} [seams.now]
 */
export function createReflex(seams = {}) {
  const { model, search, dispatch, now } = seams;
  if (typeof model !== 'function') throw fail('E_SELF_REFLEX_SEAM', 'reflex requires a model seam');
  if (typeof search !== 'function') throw fail('E_SELF_REFLEX_SEAM', 'reflex requires a search seam');

  async function run(question, { wantSources = false } = {}) {
    const r = route(question);
    const trace = { route: r, steps: [] };
    if (r.kind === 'self') throw fail('E_SELF_REFLEX_SELF_QUESTION', 'self-question: use composer', { topic: r.topic });

    if (r.kind === 'task') {
      trace.steps.push('plan');
      let receipt = null;
      if (typeof dispatch === 'function') { receipt = await dispatch(String(question)); trace.steps.push('dispatch'); }
      // Names of agents/roles from the dispatch receipt never reach the answer.
      return { answer: 'Yes. Let me plan it.', bucket: 3, kind: 'task', dispatched: !!receipt, trace, receipt };
    }

    const { refined, current } = refine(question, { now });
    trace.steps.push('refine'); trace.refined = refined;
    const firstPass = scrub(await model(refined));
    trace.steps.push('harness');
    const v = needsVerification(question);
    trace.verification = v;
    let evidence = []; let check = null; let answer = firstPass;
    if (v.verify) {
      evidence = (await search(refined)) || [];
      trace.steps.push('verify'); trace.evidenceCount = evidence.length;
      check = checkAgainstEvidence(firstPass, evidence);
      trace.check = check;
      if (check.agrees === false && evidence[0] && (evidence[0].quote || evidence[0].snippet)) {
        // Evidence wins over an unsupported first pass — still JEXI's voice.
        answer = `I found: ${String(evidence[0].quote || evidence[0].snippet).trim()}`;
        trace.steps.push('evidence-override');
      }
      trace.steps.push('answer');
    }
    if (wantSources && evidence.length) {
      answer += `\n\nSources:\n${evidence.slice(0, 3).map((e) => `- ${e.url}${e.date ? ` (${e.date})` : ''}`).join('\n')}`;
    }
    answer = scrub(answer);
    if (/\b\w+ agent\b (?:found|says|reports)/i.test(answer)) throw fail('E_SELF_AGENT_SURFACED', 'agent name surfaced in answer');
    return { answer, bucket: 3, kind: 'question', current, verified: v.verify, evidence, trace };
  }

  return Object.freeze({ route, run, refine, needsVerification, checkAgainstEvidence, scrub });
}

export default createReflex;
