/**
 * JEXI OS — Phase 19 Scope D — surfsense/podcast entry point.
 *
 * Contract:
 *   podcast.script(docs, { hosts, minutes }) -> { hosts, minutes, label,
 *                                                 segments[], totalTurns }
 *   podcast.render(script)                   -> markdown transcript text
 *
 * segments = [{ name: 'intro', turns }, { name: 'main', turns },
 *             { name: 'outro', turns }]; each turn { speaker, text, cites }
 * with cites = the doc ids the turn draws its facts from (traceable — no
 * invented facts; quoted spans are verbatim from the cited docs).
 *
 * render(script) is a pure formatter over the script shape produced by
 * script(): markdown with speaker labels, per-turn [doc-id] citations, the
 * truthfulness label, and a hosts/target/turns summary line. An empty script
 * (segments: []) renders to ''. Malformed render input is treated as an
 * empty script — script() is the validation boundary, render() only formats.
 *
 * Truthfulness: "rule-based — LLM generation NOT VERIFIED" (LABEL from
 * script.js). Determinism owned here: same inputs -> byte-identical script
 * and render. Callers must not re-compose.
 *
 * Reused public APIs (no duplication, no edits to A/B/C files):
 *   SurfError    — surfsense/connectors/_internal.js (Scope A)
 *   validateDocs — surfsense/search/keyword.js (Scope B)
 *   sentences / endStop / topTokens / docTopic — surfsense/output/formats.js
 */
import { script, assertHosts, assertMinutes, LABEL, TURNS_PER_MINUTE } from './script.js';
import { SEGMENT_NAMES, buildIntro, buildMain, buildOutro, buildSegments } from './segment.js';

/** Capitalize a segment name for the markdown header (deterministic). */
function cap(name) {
  const s = String(name);
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * podcast.render(script) -> markdown transcript.
 * Turn citations render as [doc-id] suffixes after the turn text.
 */
export function render(podcastScript) {
  const segments = Array.isArray(podcastScript?.segments) ? podcastScript.segments : [];
  if (segments.length === 0) return '';

  const lines = [];
  lines.push('# Podcast Transcript', '');
  if (typeof podcastScript.label === 'string' && podcastScript.label.length > 0) {
    lines.push(`_${podcastScript.label}_`, '');
  }
  const hostsLine = Array.isArray(podcastScript.hosts)
    ? podcastScript.hosts.join(', ')
    : 'n/a';
  const turnCount =
    podcastScript.totalTurns ??
    segments.reduce((n, s) => n + (Array.isArray(s.turns) ? s.turns.length : 0), 0);
  lines.push(`_Hosts: ${hostsLine} — target: ${podcastScript.minutes ?? 'n/a'} min — turns: ${turnCount}_`, '');

  for (const seg of segments) {
    lines.push(`## ${cap(seg.name)}`, '');
    for (const turn of Array.isArray(seg.turns) ? seg.turns : []) {
      const cites =
        Array.isArray(turn.cites) && turn.cites.length > 0
          ? ` ${turn.cites.map((c) => `[${c}]`).join(' ')}`
          : '';
      lines.push(`**${turn.speaker}:** ${turn.text}${cites}`, '');
    }
  }
  return lines.join('\n').trimEnd();
}

export { script, assertHosts, assertMinutes, LABEL, TURNS_PER_MINUTE };
export { SEGMENT_NAMES, buildIntro, buildMain, buildOutro, buildSegments };

export default {
  script,
  render,
  assertHosts,
  assertMinutes,
  LABEL,
  TURNS_PER_MINUTE,
  SEGMENT_NAMES,
  buildIntro,
  buildMain,
  buildOutro,
  buildSegments,
};
