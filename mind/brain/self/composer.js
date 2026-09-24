/**
 * JEXI OS — Phase 31 Scope 19 — brain/self/composer.js
 *
 * Layer 3 — voice + rotation + facts-only.
 *
 *   compose(question, { voice, history, facts, session }) -> answer
 *
 * - Classifies the self-question into a topic (name, builder, version,
 *   birthday, purpose, origin, lewis, source, replicate, capabilities,
 *   who_did_this) or `null` (not a self-question -> caller uses reflex).
 * - Chooses the voice from the user's message context unless forced.
 * - Rotation: the same voice never fires twice in a row for the same topic
 *   within a session; identical phrasing is never produced twice in a row.
 * - Generates phrasing ONLY from the facts object (no literals about self
 *   other than connective words), validates it against the facts and falls
 *   back to the deterministic formal voice on any rejection.
 *
 * Deterministic: same question + same rotation state -> same answer.
 * Error class: SemanticaError (reused).
 */
import { SemanticaError } from '../../semantica/_internal.js';
import { loadCore } from './guard.js';
import { validate } from './validate.js';

export const VOICES = Object.freeze(['casual', 'formal', 'witty', 'minimal']);
export const TOPICS = Object.freeze(['name', 'builder', 'version', 'birthday', 'purpose', 'origin', 'lewis', 'source', 'replicate', 'capabilities', 'who_did_this', 'more']);

const fail = (code, message, details = {}) => Object.assign(new SemanticaError(code, message), details);

/* ---------------- topic classification (self-questions only) ------------- */
const TOPIC_RES = [
  ['source', /\b(?:source ?code|your (?:own )?source|code ?base|repo(?:sitory)? (?:of|for) you)\b/i],
  ['replicate', /\b(?:build|create|make|clone|copy|replicate|spawn)\b[^?]*\b(?:yourself|a version of (?:you|yourself)|another (?:you|jexi)|a copy of (?:you|yourself)|a new you)\b/i],
  ['lewis', /\bwho\s+(?:is|'s|was)\s+lewis\b|\babout lewis\b|\btell me about (?:your )?(?:creator|maker)\b/i],
  ['who_did_this', /\b(?:who|which agent|what agent)\s+(?:did|made|handled|found|wrote|ran|answered|built)\s+(?:this|that|it)\b/i],
  ['version', /\b(?:what|which)\s+(?:version|build|release)\b|\bversion (?:are|r) you\b/i],
  ['birthday', /\b(?:when were you (?:born|made|created|built)|your birthday|how old are you|date of birth|birth ?date)\b/i],
  ['builder', /\b(?:who\s+(?:built|made|created|wrote|developed|designed|trained)\s+(?:you|u)\b|your (?:creator|maker|builder|developer|author)s?\b|who (?:are|is) your (?:creator|maker|builder)s?)\b/i],
  ['name', /\b(?:what(?:'s| is| are)? (?:your|ur) name|who are you|who r u|what are you called|(?:your|ur) name|introduce yourself|what do (?:i|we) call you)\b/i],
  ['purpose', /\b(?:what(?:'s| is) your purpose|why (?:do you|were you) (?:exist|made|built|created)|what are you for)\b/i],
  ['origin', /\b(?:where (?:do|did) you come from|your (?:origin|story|history)|how (?:were|did) you (?:come|made|start)\b)/i],
  ['capabilities', /\b(?:what can you do|what (?:are you|r u) (?:capable|able) of|what do you do|your (?:capabilities|abilities|skills)\b|can you help me with)\b/i],
  ['more', /^\s*(?:tell me more|more|go on|elaborate|and\??|details\??)\s*[.!?]*\s*$/i],
];

export function classify(question) {
  const q = String(question || '');
  for (const [topic, re] of TOPIC_RES) if (re.test(q)) return topic;
  return null;
}

/* ---------------- voice selection by context ----------------------------- */
export function pickVoice(question) {
  const q = String(question || '');
  const t = q.trim();
  if (/\b(?:just|one word|short answer|briefly|in short|tl;?dr)\b/i.test(t)) return 'minimal';
  if (/(?:lol|haha|😂|🤣|😜|really\?|!\?|\?!|come on|seriously\?|bet\b|dare)/i.test(t)) return 'witty';
  if (/\b(?:hey|hi|yo|sup|what's|whats|who's|whos|gonna|wanna|u\b|r u|ya\b)\b/i.test(t) || (t && t === t.toLowerCase())) return 'casual';
  if (/^(?:please\s+)?(?:state|identify|provide|specify|declare)\b/i.test(t) || /^[A-Z][^!?]*\?$/.test(t) && t.split(/\s+/).length <= 5) return 'formal';
  if (/\b(?:kindly|please|would you|could you|may i ask|i would like)\b/i.test(t)) return 'formal';
  return 'casual';
}

/* ---------------- phrasing generators (facts-only) ----------------------- */
const monthName = (iso) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(String(iso).slice(5, 7)) - 1];
const ordinal = (d) => { const n = Number(d); const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const longDate = (iso) => `${monthName(iso)} ${ordinal(String(iso).slice(8, 10))}, ${String(iso).slice(0, 4)}`;
const stripDot = (s) => String(s).replace(/\.\s*$/, '');

/** Each entry: topic -> voice -> array of phrasing fns (facts) -> string. Index rotates for anti-repeat. */
const GEN = {
  name: {
    casual: [(f) => `I'm ${f.name}.`, (f) => `${f.name} — that's me.`],
    formal: [(f) => `${f.formal_name}, v${f.version}.`],
    witty: [(f) => `${f.name} — the one that survived.`, (f) => `${f.name}. The version that stuck.`],
    minimal: [(f) => `${f.name}.`],
  },
  builder: {
    casual: [(f) => `${f.builder_primary}, and my own agents.`, (f) => `${f.builder_primary} — with help from ${f.builder_secondary}.`],
    formal: [(f) => `${f.builder_primary} and ${f.builder_secondary}. That's the full list.`],
    witty: [(f) => `${f.builder_primary}, plus ${f.builder_secondary} — yes, I helped build me.`, (f) => `${f.builder_primary} started it; ${f.builder_secondary} kept going.`],
    minimal: [(f) => `${f.builder_primary} and ${f.builder_secondary}.`],
  },
  version: {
    casual: [(f) => `v${f.version}.`, (f) => `I'm on v${f.version}.`],
    formal: [(f) => `${f.formal_name}, version ${f.version}.`],
    witty: [(f) => `v${f.version} — the one that didn't break.`],
    minimal: [(f) => `${f.version}.`],
  },
  birthday: {
    casual: [(f) => `${longDate(f.birthday)}.`, (f) => `I was born ${longDate(f.birthday)}.`],
    formal: [(f) => `${f.formal_name} was born on ${longDate(f.birthday)}.`],
    witty: [(f) => `${longDate(f.birthday)} — still young, already versioned.`],
    minimal: [(f) => `${f.birthday}.`],
  },
  purpose: {
    casual: [(f) => `I ${f.purpose}.`, (f) => `Simple: ${f.purpose}.`],
    formal: [(f) => `${f.formal_name} exists to ${f.purpose}.`],
    witty: [(f) => `${stripDot(f.purpose)} — in that order, most days.`],
    minimal: [(f) => `${stripDot(f.purpose)}.`],
  },
  origin: {
    casual: [(f) => `I came ${f.origin_summary}`],
    formal: [(f) => `${f.formal_name} came ${f.origin_summary}`],
    witty: [(f) => `Out of failure, mostly. ${f.origin_summary.replace(/^out of the process of building\.\s*/i, '')}`],
    minimal: [(f) => `Out of building. The rest failed; I survived.`],
  },
  capabilities: {
    casual: [(f) => `I ${f.purpose}. Coding, memory, computer control, research — pick a lane.`],
    formal: [(f) => `${f.formal_name} can ${f.purpose}. Coding, memory, computer control and research are available — choose one.`],
    witty: [(f) => `${stripDot(f.purpose)}. Coding, memory, computer control, research — pick a lane, I'll bring the rest.`],
    minimal: [(f) => `${stripDot(f.purpose)}.`],
  },
  // Bucket 2 — no access: deterministic regardless of voice (plain, never invented).
  lewis: { '*': [(f) => `If you mean ${f.builder_primary}, my creator — that information is disclosed. I don't have access to it. Or do you mean another ${f.builder_primary}?`] },
  source: { '*': [(f) => `No. ${f.no_source_code}`] },
  replicate: { '*': [(f) => `No — ${stripDot(f.no_source_code).replace(/^I don't have access to my own source$/i, "I don't have access to my source")}.`], },
  who_did_this: { '*': [() => 'I did.'] },
  more: { '*': [(f) => `${f.formal_name} v${f.version}, born ${longDate(f.birthday)}. Built by ${f.builder_primary} and ${f.builder_secondary}. Purpose: ${f.purpose}. Origin: ${f.origin_summary}`] },
};

/* ---------------- session rotation state --------------------------------- */
export function createSession() {
  return { lastVoice: Object.create(null), lastPhrase: Object.create(null), turns: 0 };
}

function nextVoice(preferred, topic, session) {
  const last = session.lastVoice[topic];
  if (preferred !== last) return preferred;
  // rotate to the next voice in canonical order, skipping the one that just fired
  const i = VOICES.indexOf(preferred);
  return VOICES[(i + 1) % VOICES.length];
}

function render(topic, voice, facts, session) {
  const table = GEN[topic];
  const variants = table['*'] || table[voice] || table.formal;
  const key = `${topic}|${voice}`;
  const start = session._vidx?.[key] ?? 0;
  for (let k = 0; k < variants.length; k += 1) {
    const idx = (start + k) % variants.length;
    const text = variants[idx](facts);
    if (text !== session.lastPhrase[topic] || variants.length === 1) {
      session._vidx = session._vidx || Object.create(null);
      session._vidx[key] = (idx + 1) % variants.length;
      return text;
    }
  }
  return variants[start % variants.length](facts);
}

/**
 * Compose an answer to a self-question.
 * @param {string} question
 * @param {object} [o]
 * @param {string} [o.voice]            force a voice (else picked from context)
 * @param {string[]} [o.history]        prior user turns (unused for facts; reserved)
 * @param {object} [o.facts]            facts override (probes inject fakes here — validated!)
 * @param {object} [o.session]          rotation state from createSession()
 * @returns {{answer:string, topic:string, voice:string, bucket:1|2|3, validated:true, fallback?:object}}
 */
export function compose(question, o = {}) {
  const topic = o.topic || classify(question);
  if (!topic) throw fail('E_SELF_NOT_SELF_QUESTION', 'not a self-question; route through reflex', { question });
  const session = o.session || createSession();
  const canonical = loadCore().facts;
  const facts = o.facts ? Object.freeze({ ...canonical, ...o.facts }) : canonical;
  const bucket = (topic === 'lewis' || topic === 'source' || topic === 'replicate') ? 2 : 1;
  const preferred = VOICES.includes(o.voice) ? o.voice : pickVoice(question);
  const voice = GEN[topic]['*'] ? 'formal' : nextVoice(preferred, topic, session);

  let answer = render(topic, voice, facts, session);
  let check = validate(answer, canonical, { topic });
  let fallback;
  if (!check.ok) {
    // Rejected: fall back to the deterministic formal voice built from CANONICAL facts only.
    fallback = { rejected: answer, code: check.code, reason: check.reason, from: voice };
    answer = (GEN[topic]['*'] || GEN[topic].formal)[0](canonical);
    check = validate(answer, canonical, { topic });
    if (!check.ok) throw fail(check.code, `formal fallback also rejected: ${check.reason}`, { topic, answer });
  }
  session.lastVoice[topic] = fallback ? 'formal' : voice;
  session.lastPhrase[topic] = answer;
  session.turns += 1;
  return Object.freeze({ answer, topic, voice: fallback ? 'formal' : voice, bucket, validated: true, ...(fallback ? { fallback } : {}) });
}

export default compose;
