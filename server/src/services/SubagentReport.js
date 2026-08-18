/**
 * B137 — SUBAGENT REPORT (DeepSeek Harness
 * `packages/subagent/tool-subagent-report` mirror, JEXI-branded).
 *
 * Child-scoped `report` tool: a subagent calls it to deliver a
 * self-contained result (or mid-run findings) to the agent that started it.
 * The parent does NOT automatically receive the child's transcript, tool
 * output, or reasoning — only what the child reports. Reporting never ends
 * the child's turn.
 *
 * Scope rules (dsh): the tool is only callable while a subagent run is
 * active for the calling conversation; outside a subagent run the engine
 * fails with an explicit error. Reports are collected per run and folded
 * into the parent's aggregate.
 */

import crypto from 'crypto';

const reportContexts = new Map(); // subagentId → { parentConv, reports: [], openedAt }

/** Open a report channel for one subagent run (called by SubagentRuntime). */
export function openReportChannel({ subagentId, parentConv }) {
  const rec = { parentConv: String(parentConv || ''), reports: [], openedAt: Date.now() };
  reportContexts.set(String(subagentId || ''), rec);
  return rec;
}

/** Deliver a report from a subagent run. Returns { ok, reportId }. */
export function deliverReport(subagentId, output) {
  const text = String(output || '').trim();
  if (!text) return { ok: false, error: 'report requires a non-empty output' };
  const rec = reportContexts.get(String(subagentId || ''));
  if (!rec) return { ok: false, error: 'report is only available inside a subagent run' };
  const report = { id: `rep-${crypto.randomUUID().slice(0, 10)}`, at: Date.now(), text: text.slice(0, 8000) };
  rec.reports.push(report);
  return { ok: true, report };
}

/** The reports delivered so far for a subagent run. */
export function reportsFor(subagentId) {
  const rec = reportContexts.get(String(subagentId || ''));
  return rec ? [...rec.reports] : [];
}

/** Close a subagent run's channel (returns its reports for aggregation). */
export function closeReportChannel(subagentId) {
  const rec = reportContexts.get(String(subagentId || ''));
  if (!rec) return [];
  reportContexts.delete(String(subagentId || ''));
  return rec.reports;
}

/** Close every channel (shutdown / tests). */
export function closeAllReportChannels() {
  reportContexts.clear();
}

/** The report tool guidance inserted into a child's context. */
export const REPORT_GUIDANCE = 'Deliver your result with the report tool before you finish: call it once with a self-contained answer. The agent that started you shares your workspace but does not automatically receive your transcript, tool output, or reasoning, so a closing remark such as "done" leaves it nothing it can use. Report earlier as well whenever a partial finding changes what that agent should do next; reporting never ends your turn.';

/** Live channels for diagnostics. */
export function reportChannelStatus() {
  return [...reportContexts.entries()].map(([id, rec]) => ({ subagentId: id, parentConv: rec.parentConv, reports: rec.reports.length }));
}
