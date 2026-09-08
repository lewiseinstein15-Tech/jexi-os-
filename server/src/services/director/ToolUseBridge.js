/**
 * ToolUseBridge — mission/employee tool events → `tool_use` SSE payloads.
 *
 * The Director lane and the mission lane execute REAL tools (web-search,
 * MCP live-data calls, employee shell commands, test runs) but surfaced
 * them only as narration (`log`) + team-strip events — so the
 * agent-transcript UI (StepRow) never rendered a row for them.
 *
 * EmployeeSession tags each paired STARTED→COMPLETED/FAILED sequence with a
 * unique data.toolId (+ kind, durationMs, detail). This module maps those
 * tagged events — and ONLY those — onto the `tool_use` shape the frontend
 * already renders. It is stateless and pure: STARTED and completion share
 * the deterministic row id `tu-<toolId>`, so running rows flip to
 * success/error in place, including on replayed (persisted) events.
 *
 * Only real, measured executions become rows. Anything without a toolId
 * (narration, permission gates, artifact bookkeeping) returns null.
 */

const ROW_ID_PREFIX = 'tu-';

export function toolUseRowId(toolId) {
  return `${ROW_ID_PREFIX}${toolId}`;
}

export function missionEventToToolUse(evt) {
  if (!evt || typeof evt !== 'object') return null;
  const d = evt.data && typeof evt.data === 'object' ? evt.data : null;
  const toolId = d && typeof d.toolId === 'string' && d.toolId ? d.toolId : null;
  if (!toolId) return null;
  const type = String(evt.type || '');
  let status = null;
  if (type.endsWith('_STARTED')) status = 'running';
  else if (type.endsWith('_COMPLETED')) status = 'success';
  else if (type.endsWith('_FAILED')) status = 'error';
  if (!status) return null;
  const kind = d.kind === 'Bash' ? 'Bash' : 'Read';
  const durationMs = status === 'running' ? 0 : Math.max(0, Math.round(Number(d.durationMs) || 0));
  return {
    id: toolUseRowId(toolId),
    tool: kind,
    slug: typeof d.slug === 'string' ? d.slug.slice(0, 80) : '',
    status,
    duration_ms: durationMs,
    summary: String(evt.summary || '').slice(0, 200),
    detail: typeof d.detail === 'string' ? d.detail.slice(0, 4000) : '',
  };
}
