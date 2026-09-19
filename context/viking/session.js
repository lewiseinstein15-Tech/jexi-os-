/**
 * JEXI OS — Phase 17 Scope E — CONTEXT FILESYSTEM / SESSION PIPELINE.
 *
 * session.capture(fs, session) — write a finished working session into
 * viking://session/<id>/ so future agents can BROWSE it instead of replaying
 * a raw transcript:
 *
 *   viking://session/<id>/summary.md     L0/L1 explicit, L2 = the summary
 *   viking://session/<id>/decisions.md   one decision per line
 *   viking://session/<id>/turns.md       full transcript (the L2 archive)
 *
 * The session dir's own sidecar carries an L0 ("what is this session") and
 * L1 (decisions overview) so listing viking://session/ is enough to judge
 * relevance. Accepts any { sessionId, turns, decisions, summary, label };
 * the probe uses a synthetic session and labels it as such.
 *
 * `toSessionMemory(fs, {scope})` — the reverse edge: L0+L1 of every captured
 * session flattened into a memory-ready digest (feeds the Phase 17(D)
 * enhancement layer's store as plain MemoryEntry-shaped objects).
 */

import { buildUri, joinUri, parseUri } from './uri.js';
import { firstSentence } from './filesystem.js';

const turnLine = (t) => `${String(t.role || 'unknown')}: ${String(t.text || '').replace(/\s+/g, ' ').trim()}`;

/**
 * @param {import('./filesystem.js').VikingFs} fs
 * @param {object} session
 * @param {string} session.sessionId
 * @param {Array<{role: string, text: string}>} session.turns
 * @param {string[]} [session.decisions]
 * @param {string} [session.summary]   full-text summary (L2); generated when absent
 * @param {string} [session.title]
 * @param {string} [session.label]     provenance, e.g. 'synthetic session'
 * @returns {{ root, uris, l0, l1, written: number }}
 */
export function capture(fs, session) {
  const { sessionId, turns = [], decisions = [] } = session || {};
  if (!sessionId) throw Object.assign(new Error('session.capture: sessionId is required'), { code: 'E_SESSION_ID_REQUIRED' });
  if (!Array.isArray(turns) || turns.length === 0) throw Object.assign(new Error('session.capture: turns[] is required'), { code: 'E_EMPTY_SESSION' });

  const root = joinUri('viking://session', sessionId);
  const label = session.label || 'captured session';
  const roles = [...new Set(turns.map((t) => t.role))];
  const firstDecision = decisions[0] || 'none recorded';

  const summaryText = session.summary != null ? String(session.summary) : [
    `# Session ${sessionId}`,
    '',
    `Provenance: ${label}.`,
    `${turns.length} turns across roles: ${roles.join(', ')}.`,
    '',
    '## Decisions',
    ...decisions.map((d) => `- ${d}`),
    '',
    '## Highlights',
    ...turns.filter((t) => String(t.text || '').length > 40).slice(0, 3).map((t) => `- ${turnLine(t)}`),
  ].join('\n');

  const l0 = `Session ${sessionId} (${label}): ${turns.length} turns across ${roles.length} role(s); key decision: ${firstSentence(firstDecision, { maxChars: 90 })}`;
  const l1 = [
    `Decisions (${decisions.length}):`,
    ...decisions.map((d) => `- ${d}`),
    `Transcript: ${turns.length} turns (${roles.join(', ')}).`,
  ].join('\n');

  let written = 0;
  const uris = {
    summary: `${root}/summary.md`,
    decisions: `${root}/decisions.md`,
    turns: `${root}/turns.md`,
  };
  fs.write(uris.summary, summaryText, { l0, l1 }); written += 1;
  fs.write(uris.decisions, decisions.length ? decisions.map((d) => `- ${d}`).join('\n') : '(none recorded)', { l0: `Decisions from session ${sessionId}: ${decisions.length} recorded.` }); written += 1;
  fs.write(uris.turns, turns.map(turnLine).join('\n'), { l0: `Full transcript of session ${sessionId} — ${turns.length} turns.` }); written += 1;

  return { root, uris, l0, l1, written, label };
}

/**
 * Flatten captured sessions into memory-entry-shaped digests (the
 * session → memory pipeline; entries match the Phase 4 MemoryEntry contract
 * and the Phase 17(D) confidence/lifecycle layer consumes them as-is).
 */
export function toSessionMemory(fs, { scopeUri = 'viking://session' } = {}) {
  const out = [];
  for (const entry of fs.ls(scopeUri)) {
    if (entry.type !== 'dir') continue;
    let l0 = entry.l0;
    if (!l0) {
      try { l0 = fs.read(entry.uri, { tier: 'L0' }).content; } catch { l0 = null; }
    }
    out.push({
      id: `session:${parseUri(entry.uri).path}`,
      missionId: 'session-memory',
      tier: 'episodic',
      content: l0 || '(no L0)',
      createdAt: Date.now(),
      metadata: { sourceReliability: 0.6, kind: 'session-digest', uri: entry.uri },
    });
  }
  return out;
}

export default { capture, toSessionMemory };
