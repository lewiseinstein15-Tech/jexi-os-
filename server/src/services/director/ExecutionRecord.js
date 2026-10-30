/**
 * JEXI OS — DIRECTOR — EXECUTION RECORD (M6 Defect 2).
 *
 * ONE authoritative representation of "what actually happened when a tool
 * ran", derived ONLY from the task's canonical event log. The final response
 * is written from this record, so the prose can never contradict the evidence.
 *
 * The defect this closes: `composeReport` told the report model
 * "Real commands executed this task: NONE" whenever it saw no
 * COMMAND_COMPLETED/TEST_COMPLETED event — ignoring COMMAND_FAILED. So a
 * command that really ran and exited 3 was reported to the user as
 * "It wasn't executed this turn". A FAILED run is still a RUN.
 *
 * Outcome vocabulary (each tool execution lands in exactly one):
 *   not_attempted           — no record of it (never invoked)
 *   blocked                 — attempted, refused by a gate before execution
 *   running                 — started, no terminal event recorded
 *   succeeded               — completed, exit 0 / ok
 *   failed_nonzero          — completed, non-zero exit
 *   failed_before_execution — the tool itself errored before doing its work
 *   timed_out               — started and exceeded its budget
 *   cancelled               — started and cancelled
 */

export const OUTCOMES = Object.freeze({
  NOT_ATTEMPTED: 'not_attempted',
  BLOCKED: 'blocked',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED_NONZERO: 'failed_nonzero',
  FAILED_BEFORE_EXECUTION: 'failed_before_execution',
  TIMED_OUT: 'timed_out',
  CANCELLED: 'cancelled',
});

const START_TYPES = new Set(['COMMAND_STARTED', 'TEST_STARTED']);
const SUCCESS_TYPES = new Set(['COMMAND_COMPLETED', 'TEST_COMPLETED']);
const FAIL_TYPES = new Set(['COMMAND_FAILED', 'TEST_FAILED']);
const BLOCK_TYPES = new Set(['PERMISSION_DENIED', 'COMPUTER_BLOCKED']);
const PRE_EXEC_FAIL_TYPES = new Set(['TOOL_FAILED', 'ERROR_DETECTED']);

/** Classify ONE terminal-ish event into an outcome, or null when it carries no
 *  outcome of its own (e.g. a *_STARTED marker). */
function outcomeOf(evt) {
  const type = String((evt && evt.type) || '');
  const data = (evt && evt.data) || {};
  if (BLOCK_TYPES.has(type)) return OUTCOMES.BLOCKED;
  if (FAIL_TYPES.has(type)) {
    if (data.timedOut) return OUTCOMES.TIMED_OUT;
    if (data.blocked) return OUTCOMES.BLOCKED;
    const exit = data.exitCode;
    return (exit === undefined || exit === null || exit === 0)
      ? OUTCOMES.FAILED_BEFORE_EXECUTION
      : OUTCOMES.FAILED_NONZERO;
  }
  if (SUCCESS_TYPES.has(type)) return data.timedOut ? OUTCOMES.TIMED_OUT : OUTCOMES.SUCCEEDED;
  if (PRE_EXEC_FAIL_TYPES.has(type)) return OUTCOMES.FAILED_BEFORE_EXECUTION;
  return null;
}

/** A tool label: the command text for a command event, else the slug/type. */
function labelOf(evt) {
  const data = (evt && evt.data) || {};
  return String(data.command || data.file || data.slug || data.tool || (evt && evt.type) || 'tool').slice(0, 200);
}

/**
 * Derive the authoritative execution record from a task's event log.
 *
 * @param {Array} events canonical task events (teamEvent shape)
 * @returns {{
 *   commands: Array<object>, tools: Array<object>,
 *   counts: Record<string, number>, ran: boolean,
 *   executedCount: number, failedCount: number, blockedCount: number,
 *   startedOnly: Array<object>
 * }}
 */
export function deriveExecutionRecord(events = []) {
  const list = Array.isArray(events) ? events : [];
  const commands = [];
  const tools = [];
  const started = new Map(); // toolId → start event (to resolve running vs terminal)

  for (const evt of list) {
    const type = String((evt && evt.type) || '');
    const data = (evt && evt.data) || {};
    const toolId = data.toolId || null;
    if (START_TYPES.has(type)) {
      if (toolId) started.set(toolId, evt);
      continue;
    }
    const outcome = outcomeOf(evt);
    if (!outcome) continue;
    const rec = {
      outcome,
      label: labelOf(evt),
      command: data.command || null,
      exitCode: data.exitCode ?? null,
      timedOut: Boolean(data.timedOut),
      blocked: Boolean(data.blocked),
      reason: data.reason || null,
      ms: data.ms ?? null,
      agent: (evt && evt.agentName) || null,
      at: (evt && evt.ts) || null,
    };
    if (toolId) started.delete(toolId);
    const isCommandish = Boolean(data.command) || type.startsWith('COMMAND') || type.startsWith('TEST');
    (isCommandish ? commands : tools).push(rec);
  }
  // Anything that STARTED and never reached a terminal event is still running.
  const startedOnly = [...started.values()].map((evt) => ({
    outcome: OUTCOMES.RUNNING,
    label: labelOf(evt),
    command: (evt.data && evt.data.command) || null,
    at: evt.ts || null,
  }));

  const all = [...commands, ...tools];
  const counts = {};
  for (const k of Object.values(OUTCOMES)) counts[k] = 0;
  for (const r of all) counts[r.outcome] += 1;
  counts[OUTCOMES.RUNNING] += startedOnly.length;

  const executedCount = counts[OUTCOMES.SUCCEEDED] + counts[OUTCOMES.FAILED_NONZERO]
    + counts[OUTCOMES.TIMED_OUT] + counts[OUTCOMES.CANCELLED];
  return {
    commands,
    tools,
    counts,
    ran: executedCount > 0 || startedOnly.length > 0,
    executedCount,
    failedCount: counts[OUTCOMES.FAILED_NONZERO] + counts[OUTCOMES.FAILED_BEFORE_EXECUTION],
    blockedCount: counts[OUTCOMES.BLOCKED],
    startedOnly,
  };
}

/** Human/model-readable lines describing the record. The FIRST line is the
 *  critical one: whether anything actually executed. */
export function executionRecordLines(record) {
  const lines = [];
  const executed = record.commands.filter((c) => c.outcome !== OUTCOMES.BLOCKED && c.outcome !== OUTCOMES.FAILED_BEFORE_EXECUTION);
  if (!record.ran) {
    lines.push('Real commands executed this task: NONE — no command was executed; do NOT present any output as "executed" — label code as provided-but-not-run');
  } else {
    lines.push('Real commands executed this task (a run that FAILED still ran — never say it was not executed):');
    for (const c of executed) {
      const verdict = c.outcome === OUTCOMES.SUCCEEDED ? 'exit 0'
        : c.outcome === OUTCOMES.TIMED_OUT ? `timed out${c.exitCode != null ? ` (exit ${c.exitCode})` : ''}`
        : c.outcome === OUTCOMES.CANCELLED ? 'cancelled'
        : `exit ${c.exitCode ?? '?'}`;
      lines.push(`- \`${c.command || c.label}\` → ${verdict} [${c.outcome}]`);
    }
    if (!executed.length && record.blockedCount) {
      lines.push('- (every command was BLOCKED before execution — none ran)');
    }
  }
  if (record.blockedCount) {
    const b = record.commands.concat(record.tools).filter((r) => r.outcome === OUTCOMES.BLOCKED);
    lines.push(`Blocked before execution: ${b.length}${b.length ? ` (${b.slice(0, 3).map((r) => `${r.label}${r.reason ? ` — ${r.reason}` : ''}`).join('; ')})` : ''}`);
  }
  if (record.counts[OUTCOMES.FAILED_BEFORE_EXECUTION]) {
    lines.push(`Tools that failed before executing: ${record.counts[OUTCOMES.FAILED_BEFORE_EXECUTION]}`);
  }
  if (record.startedOnly.length) {
    lines.push(`Still running when the record was taken: ${record.startedOnly.length} (${record.startedOnly.slice(0, 3).map((r) => r.label).join('; ')})`);
  }
  return lines;
}

/** Compact prose for a task's stored result — the same truth the report sees. */
export function executionSummaryLine(record) {
  if (!record.ran) return record.blockedCount ? 'no command executed (all blocked before execution)' : 'no command executed';
  const parts = [];
  if (record.counts[OUTCOMES.SUCCEEDED]) parts.push(`${record.counts[OUTCOMES.SUCCEEDED]} succeeded`);
  if (record.counts[OUTCOMES.FAILED_NONZERO]) parts.push(`${record.counts[OUTCOMES.FAILED_NONZERO]} failed (non-zero exit)`);
  if (record.counts[OUTCOMES.TIMED_OUT]) parts.push(`${record.counts[OUTCOMES.TIMED_OUT]} timed out`);
  if (record.counts[OUTCOMES.BLOCKED]) parts.push(`${record.counts[OUTCOMES.BLOCKED]} blocked`);
  return `commands executed: ${parts.join(', ') || `${record.executedCount} ran`}`;
}
