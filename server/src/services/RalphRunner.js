/**
 * B135 — RALPH LOOP (DeepSeek Harness `packages/workflow/tool-ralph` mirror).
 *
 * Model-facing foreground Ralph loop: iterate toward ONE immutable objective
 * with a FRESH structured-output child per round. Each round opens a new
 * context with no parent conversation and no prior child session; only a
 * bounded structured report crosses rounds (the shared workspace is the
 * long-term memory). The call returns when a worker reports completion or a
 * concrete blocker, or at the round limit.
 *
 * The round report contract (validated exactly like dsh tool-ralph):
 *   { status: 'continue'|'complete'|'blocked', summary, evidence: string[],
 *     nextSteps: string[], blocker }            — normalized strings only
 *   continue   → needs ≥1 nextSteps and an EMPTY blocker
 *   complete   → needs ≥1 evidence, ZERO nextSteps, EMPTY blocker
 *   blocked    → needs a concrete blocker
 *   handoff    → serialized report ≤ maxHandoffChars
 *
 * Terminal statuses: complete | blocked | budget-limited | round-failed.
 */

import { generateContent } from './LLMClient.js';

const REPORT_SCHEMA_DOC = `{
  "status": "continue" | "complete" | "blocked",
  "summary": "non-empty trimmed string",
  "evidence": ["non-empty trimmed strings"],
  "nextSteps": ["non-empty trimmed strings"],
  "blocker": "non-empty trimmed string ONLY when status is blocked; otherwise empty string"
}`;

export const RALPH_STATUSES = ['complete', 'blocked', 'budget-limited', 'round-failed'];

function normalizedText(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function normalizedList(value) {
  return Array.isArray(value) && value.every(normalizedText);
}

/** Validate a round report; throws with the DSH-style message on violation. */
export function validateRalphReport(report, maxHandoffChars = 16384) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Ralph child returned no structured round report');
  }
  if (!normalizedText(report.summary)) throw new Error('Ralph round report summary must be non-empty and normalized');
  if (!normalizedList(report.evidence) || !normalizedList(report.nextSteps)) {
    throw new Error('Ralph round report evidence and nextSteps must contain only non-empty normalized strings');
  }
  if (typeof report.blocker !== 'string' || report.blocker !== report.blocker.trim()) {
    throw new Error('Ralph round report blocker must be a normalized string');
  }
  switch (report.status) {
    case 'continue':
      if (report.nextSteps.length === 0 || report.blocker !== '') {
        throw new Error('a continuing Ralph report needs nextSteps and an empty blocker');
      }
      break;
    case 'complete':
      if (report.evidence.length === 0 || report.nextSteps.length !== 0 || report.blocker !== '') {
        throw new Error('a complete Ralph report needs evidence, no nextSteps, and an empty blocker');
      }
      break;
    case 'blocked':
      if (!normalizedText(report.blocker)) throw new Error('a blocked Ralph report needs a concrete blocker');
      break;
    default:
      throw new Error('Ralph round report status is invalid');
  }
  const serialized = JSON.stringify(report);
  if (serialized.length > maxHandoffChars) {
    throw new Error(`Ralph round report exceeds maxHandoffChars (${serialized.length} > ${maxHandoffChars})`);
  }
  return report;
}

/** Defensively decode raw LLM output into a report (or throw). */
export function decodeRalphReport(raw, maxHandoffChars) {
  let parsed;
  const text = String(raw || '').trim();
  if (!text) throw new Error('Ralph child returned no structured round report');
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text) || /\{[\s\S]*\}/.exec(text);
    if (!m) throw new Error('Ralph child returned no structured round report');
    parsed = JSON.parse(m[1]);
  }
  return validateRalphReport(parsed, maxHandoffChars);
}

/** One fresh round prompt (immutable objective + bounded handoff). */
function roundPrompt({ objective, round, maxRounds, previous }) {
  const prior = previous === undefined ? '(none — this is the first round)' : JSON.stringify(previous);
  return [
    'You are one fresh worker in a foreground Ralph loop. You receive no parent conversation and no prior child session. Do not call the ralph tool: this round already is its worker.',
    `Immutable objective:\n${objective}`,
    `Ralph round: ${round} of ${maxRounds}.`,
    'The shared workspace and its current working tree are the long-term memory and source of truth. Inspect them before acting, preserve existing work, perform concrete in-scope work, and verify what you change. Treat the previous report only as a bounded handoff; confirm it against the workspace.',
    `Previous structured handoff:\n${prior}`,
    `Return ONE JSON object with exact normalized strings matching:\n${REPORT_SCHEMA_DOC}\nUse status "continue" with at least one nextSteps entry while useful work remains; "complete" only with concrete evidence and no nextSteps; "blocked" only when no meaningful progress is possible without human input or an external-state change. blocker must be empty unless blocked.`,
  ].join('\n\n');
}

/**
 * Run the Ralph loop.
 * @param {object} params { objective, maxRounds?, maxHandoffChars?, maxResultChars?, signal?, sendEvent?, roundFn? }
 *   roundFn — test/provider seam: a fresh structured-output child (defaults to
 *   one fresh generateContent call per round, like dsh's fresh subagent).
 * @returns {Promise<{status, roundsStarted, report?, lastReport?, error?}>}
 */
export async function runRalph({ objective, maxRounds = 12, maxHandoffChars = 16384, maxResultChars = 16384, signal, sendEvent, roundFn = null }) {
  const emit = (type, payload) => { try { if (typeof sendEvent === 'function') sendEvent(type, payload); } catch { /* noop */ } };
  const obj = String(objective || '').trim();
  if (!obj) return { ok: false, error: 'Ralph requires a non-empty objective' };
  const rounds = Math.min(Math.max(Number(maxRounds) || 12, 1), 64); // deployment ceiling
  const handoffCap = Math.min(Math.max(Number(maxHandoffChars) || 16384, 256), 65536);
  const resultCap = Math.min(Math.max(Number(maxResultChars) || 16384, 256), 65536);

  emit('ralph.start', { objective: obj.slice(0, 200), maxRounds: rounds });

  let previous;
  for (let round = 1; round <= rounds; round += 1) {
    if (signal && signal.aborted) {
      return { ok: false, status: 'round-failed', roundsStarted: round, lastReport: previous ?? null, error: 'cancelled' };
    }
    const prompt = roundPrompt({ objective: obj, round, maxRounds: rounds, previous });
    let rawReport = null;
    try {
      if (typeof roundFn === 'function') {
        rawReport = await roundFn({ prompt, round, previous });
      } else {
        const system = 'You are one fresh worker in a Ralph loop. Return only the single JSON report object requested — nothing else, no markdown fences.';
        const text = await generateContent(prompt, system, null, { temperature: 0.3, signal });
        rawReport = text;
      }
    } catch (e) {
      if (signal && signal.aborted) return { ok: false, status: 'round-failed', roundsStarted: round, lastReport: previous ?? null, error: 'cancelled' };
      emit('ralph.round-failed', { round, error: String((e && e.message) || e).slice(0, 300) });
      return { ok: false, status: 'round-failed', roundsStarted: round, lastReport: previous ?? null, error: (e && e.message) || String(e) };
    }

    let report;
    try {
      report = decodeRalphReport(rawReport, handoffCap);
    } catch (e) {
      emit('ralph.round-failed', { round, error: String((e && e.message) || e).slice(0, 300) });
      return { ok: false, status: 'round-failed', roundsStarted: round, lastReport: previous ?? null, error: (e && e.message) || String(e) };
    }

    emit('ralph.round', { round, status: report.status, summary: report.summary.slice(0, 200), evidence: report.evidence.length, nextSteps: report.nextSteps.length });

    if (report.status === 'complete') {
      const finalText = JSON.stringify(report);
      emit('ralph.done', { status: 'complete', roundsStarted: round, report: finalText.slice(0, resultCap) });
      return { ok: true, status: 'complete', roundsStarted: round, report: JSON.parse(finalText) };
    }
    if (report.status === 'blocked') {
      const finalText = JSON.stringify(report);
      emit('ralph.done', { status: 'blocked', roundsStarted: round, report: finalText.slice(0, resultCap) });
      return { ok: false, status: 'blocked', roundsStarted: round, report: JSON.parse(finalText), error: report.blocker };
    }
    previous = report;
  }

  const finalText = JSON.stringify(previous);
  emit('ralph.done', { status: 'budget-limited', roundsStarted: rounds, report: finalText.slice(0, resultCap) });
  return { ok: false, status: 'budget-limited', roundsStarted: rounds, report: previous, error: `Ralph reached the round limit (${rounds}) without completion` };
}
