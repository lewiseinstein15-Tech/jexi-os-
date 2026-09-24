/**
 * JEXI OS — Phase 19 Scope D — segment breakdown (intro / main / outro).
 *
 * SurfSense research note: SurfSense's Studio podcast pipeline (surfsense_local/
 * backend/modules/artifacts/podcast/brief.py) plans an episode as a reviewed
 * brief — Speaker {name, role, voice} list (MAX_SPEAKERS = 6, two-speaker
 * default, roles by slot), a Duration preset mapped to MINUTES {short: 3,
 * standard: 8, long: 15} that bounds the episode, and options validated up
 * front with one readable error. This module ports the SHAPE of that pipeline
 * to a rule-based composer: intro / main / outro segments, turn-by-turn
 * dialogue rotating through the caller's hosts, and every factual statement
 * quoted or derived from a specific source document (turn.cites carries the
 * doc ids — no invented facts).
 *
 * Truthfulness label: "rule-based — LLM generation NOT VERIFIED" (surfaced on
 * the script object and in render output). No LLM, no TTS, no network.
 *
 * Determinism: pure functions of (docs, hosts, turn budget). Templates are
 * cycled by pass index (deterministic), speakers rotate by global turn index
 * (host at turn t = hosts[t % hosts.length] — supports 2+ hosts, SurfSense's
 * multi-speaker brief pattern). Builders never mutate inputs.
 *
 * Reuse: sentence splitting, end-stop, tf keyword/topic extraction come from
 * the Scope C public API (surfsense/output/formats.js) — reuse, not
 * duplication.
 */
import { sentences, endStop, topTokens, docTopic } from '../output/formats.js';

export const SEGMENT_NAMES = ['intro', 'main', 'outro'];

/** Turn budget: intro (2) + outro (2) are fixed; main fills the rest. */
export const FIXED_TURNS = { intro: 2, outro: 2 };

/** Deterministic lead-in / reaction templates, cycled by pass index. */
const LEAD_INS = ['First up', 'Next up', 'Also on the desk', 'Back to the sources', 'Circling forward'];
const REACTIONS = ['That tracks.', 'Good context.', 'Right — and it goes further.'];

/** Display source for quotes: title when present, else id. */
function sourceTitle(doc) {
  return doc.title ?? doc.id;
}

/**
 * Intro segment (2 turns): greeting chatter (no facts -> empty cites) + a
 * corpus fact (doc count, top-of-stack source) cited to that source.
 */
export function buildIntro(docs, hosts) {
  const others = hosts.slice(1).join(' and ');
  const top = docs[0];
  return {
    name: 'intro',
    turns: [
      {
        speaker: hosts[0 % hosts.length],
        text: `Welcome back to the research desk — I'm ${hosts[0]}, joined by ${others}.`,
        cites: [],
      },
      {
        speaker: hosts[1 % hosts.length],
        text: `Today's desk holds ${docs.length} documents — top of the stack: "${sourceTitle(top)}".`,
        cites: [top.id],
      },
    ],
  };
}

/**
 * Main segment: pairs of turns (present a quoted fact, react with the doc's
 * own keywords/topic + a second quoted fact). Docs cycle in caller rank
 * order; each full cycle is a "pass" that shifts the quoted sentence window
 * and the templates, so repeats stay honest and deterministic. Every turn
 * cites the doc it draws from.
 */
export function buildMain(docs, hosts, mainTurns, startIndex = FIXED_TURNS.intro) {
  const pairs = Math.floor(Math.max(0, mainTurns) / 2);
  const turns = [];
  for (let j = 0; j < pairs; j += 1) {
    const doc = docs[j % docs.length];
    const pass = Math.floor(j / docs.length);
    const sents = sentences(doc.text);
    const si = (pass * 2) % sents.length;
    const kws = topTokens(doc.text, 3).join(', ');
    const topic = docTopic(doc);
    const turnIndex = startIndex + j * 2;

    const presentText = `${LEAD_INS[pass % LEAD_INS.length]}: "${sourceTitle(doc)}" — the source says: "${endStop(sents[si])}"`;
    turns.push({
      speaker: hosts[turnIndex % hosts.length],
      text: presentText,
      cites: [doc.id],
    });

    const reacts = REACTIONS[pass % REACTIONS.length];
    const reactText =
      sents.length > 1
        ? `${reacts} The same source on ${topic} keeps pointing at ${kws} — it adds: "${endStop(sents[(si + 1) % sents.length])}"`
        : `${reacts} The same source on ${topic} keeps pointing at ${kws}.`;
    turns.push({
      speaker: hosts[(turnIndex + 1) % hosts.length],
      text: reactText,
      cites: [doc.id],
    });
  }
  return { name: 'main', turns };
}

/**
 * Outro segment (2 turns): wrap-up naming first/last sources (cited) + full
 * citation list read-out (cited to every source).
 */
export function buildOutro(docs, hosts, startIndex) {
  const first = docs[0];
  const last = docs[docs.length - 1];
  const ids = docs.map((d) => d.id);
  return {
    name: 'outro',
    turns: [
      {
        speaker: hosts[startIndex % hosts.length],
        text: `Let's wrap. We covered ${docs.length} sources today, opening with "${sourceTitle(first)}" and closing on "${sourceTitle(last)}".`,
        cites: [first.id, last.id],
      },
      {
        speaker: hosts[(startIndex + 1) % hosts.length],
        text: `Full citation list: ${ids.join(', ')}. Thanks for listening.`,
        cites: [...ids],
      },
    ],
  };
}

/**
 * Full segment breakdown: [intro, main, outro] in canonical order. mainTurns
 * is the (even) caller budget computed by script.js from the minutes target.
 */
export function buildSegments(docs, hosts, mainTurns) {
  const intro = buildIntro(docs, hosts);
  const main = buildMain(docs, hosts, mainTurns, intro.turns.length);
  const outro = buildOutro(docs, hosts, intro.turns.length + main.turns.length);
  return [intro, main, outro];
}
