/**
 * M9 — SUBAGENT ISOLATION BOUNDARY.
 *
 * The single, deterministic place where an isolated child's private execution
 * transcript is reduced to the fields a parent is allowed to see. Every path
 * out of an isolated child (result object, summary, artifacts, error, streamed
 * events, aggregate) funnels through the helpers here, so the contract is
 * enforced by construction rather than by trusting a summarizer's prose.
 *
 * CONTRACT (what may cross the boundary)
 *   permitted : a bounded summary (hard character cap), a validated status,
 *               explicitly approved artifacts (the child's `report` tool), and
 *               necessary, sanitized error information.
 *   private   : the raw transcript, the child's streaming tokens, its
 *               reasoning, and its raw tool output. None of these may reach
 *               the parent merely because an LLM was asked to summarize.
 *
 * DESIGN RULE: model-generated prose is a COSMETIC LAYER, never a security
 * control. It is only accepted after it passes deterministic gates, and the
 * deterministic cap is applied last — so the boundary holds with no provider,
 * a hostile provider, or a paraphrasing provider.
 *
 * Residual limitation (documented, not hidden): a summary is a lossy
 * reduction of content the child legitimately produced, so a marker the child
 * chose to surface near the head of its report can appear inside the bounded
 * summary. The boundary guarantees BOUNDEDNESS and the ABSENCE of the raw
 * transcript, not semantic secrecy of every token the child emitted.
 */

/** Hard cap on the parent-visible summary, in characters. */
export const MAX_PARENT_SUMMARY_CHARS = 350;

/** Hard cap on a single approved artifact's text. */
export const MAX_ARTIFACT_CHARS = 2000;

/** Hard cap on a sanitized error string. */
export const MAX_ERROR_CHARS = 300;

const clip = (s, n) => {
  const t = String(s ?? '');
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
};

/* ── status ──────────────────────────────────────────────────────────────── */

const STATUSES = new Set(['PASS', 'FAIL', 'cancelled', 'blocked', 'timeout']);

/**
 * Normalize an internal status to the parent-visible vocabulary. Never invents
 * success: an unknown value degrades to FAIL, which is the honest default.
 */
export function sanitizeStatus(status) {
  const s = String(status ?? '').trim();
  if (STATUSES.has(s)) return s;
  if (s === 'done') return 'PASS';
  if (s === 'failed') return 'FAIL';
  return 'FAIL';
}

/* ── summary ─────────────────────────────────────────────────────────────── */

/**
 * Deterministic, model-independent summary of a child transcript.
 * Returns a head slice bounded by MAX_PARENT_SUMMARY_CHARS. This is the
 * fallback whenever no summarizer is available and the shape a model summary
 * must also satisfy.
 */
export function deterministicSummary(transcript) {
  return clip(String(transcript ?? ''), MAX_PARENT_SUMMARY_CHARS);
}

/**
 * The summary boundary. `modelText` is the OPTIONAL cosmetic refinement (an LLM
 * one-liner); `transcript` is the child's full text, used only to produce the
 * deterministic fallback. The model text is accepted only when it is non-empty
 * and strictly bounded; otherwise the deterministic summary is used. The cap
 * is applied to whichever survives, so the result is ALWAYS bounded — this is
 * what makes the boundary independent of the provider.
 */
export function boundSummary({ transcript = '', modelText = '' } = {}) {
  const model = String(modelText ?? '').trim();
  if (model) return clip(model, MAX_PARENT_SUMMARY_CHARS);
  return deterministicSummary(transcript);
}

/* ── artifacts ───────────────────────────────────────────────────────────── */

/**
 * Extract APPROVED artifacts. An artifact is approved only when the child
 * explicitly delivered it through the `report` tool (the sanctioned channel:
 * a child decides what the parent needs). The runtime never lifts lines out of
 * the raw transcript, because any line — including a secret — can satisfy a
 * shape heuristic. Unapproved input is ignored, never emitted.
 */
export function extractApprovedArtifacts(reports) {
  if (!Array.isArray(reports)) return [];
  return reports
    .map((r) => (r && typeof r === 'object' ? r.text : r))
    .map((t) => String(t ?? '').trim())
    .filter(Boolean)
    .map((t) => clip(t, MAX_ARTIFACT_CHARS))
    .slice(0, 8);
}

/* ── errors ──────────────────────────────────────────────────────────────── */

/** Sanitize an error for the parent: message only, bounded, single line. */
export function sanitizeError(err) {
  const raw = err && typeof err === 'object' ? err.message : err;
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return clip(s, MAX_ERROR_CHARS);
}

/* ── events ──────────────────────────────────────────────────────────────── */

/**
 * Event types a child may NOT forward to the parent. Each carries transcript,
 * reasoning, or raw tool output.
 */
export const PRIVATE_CHILD_EVENT_TYPES = new Set([
  'stream',       // token deltas — the answer being written
  'think',        // chain-of-thought
  'agent.done',   // the child's full final answer
  'agent.log',    // tool output / contract detail
  'log',          // child narration
  'tool.result',  // raw tool output
  'tool.call',
]);

/**
 * A parent-visible, transcript-free projection of one child event. Returns
 * null when the event must not cross the boundary at all. Permitted lifecycle
 * events (plan / start / progress) are rebuilt from a fixed allowlist of
 * fields, so a hostile payload cannot smuggle transcript text through an
 * unexpected key.
 */
export function sanitizeChildEvent(type, data) {
  const t = String(type ?? '');
  if (PRIVATE_CHILD_EVENT_TYPES.has(t)) return null;
  const d = data && typeof data === 'object' ? data : {};
  switch (t) {
    case 'subagent.start':
      return { name: clip(d.name, 120), isolated: true };
    case 'subagent.plan':
      return { total: Number(d.total) || 0, names: Array.isArray(d.names) ? d.names.slice(0, 16).map((n) => clip(n, 120)) : [] };
    case 'subagent.progress':
      return { name: clip(d.name, 120), toolCalls: Number(d.toolCalls) || 0 };
    default:
      return null; // unknown → not forwarded (default-deny)
  }
}
