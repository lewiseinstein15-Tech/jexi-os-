/**
 * JEXI OS — Phase 23 Scope C — ralph diagnostics: policy evaluator.
 *
 * Evaluates one Ralph loop iteration against the six-dimension loop policy
 * (what emerged across Phase 20 F and the harness at large):
 *
 *   1. task selection          task declared and non-empty
 *   2. verification level      verification declared, not 'none'
 *   3. required tests          tests listed (non-empty set)
 *   4. skill usage             skills listed (warn when absent)
 *   5. logging completeness    logs present and substantial (warn when sparse)
 *   6. deviation justification every deviation carries a justification
 *
 * THE CONTRACT
 *   evaluate({ task, verification, tests, skills, logs, deviations })
 *     -> { ok, findings: [{ code, severity, detail }] }
 *
 *   ok: true  <=>  findings.length === 0 (clean input)
 *   severity  'error' | 'warn' | 'info'  (info reserved for future advisory
 *              rules; current rules are error + warn tiers)
 *
 * FINDINGS, NOT THROWS
 * Policy violations are FINDINGS with stable codes — the evaluator's job is
 * to report the state of the loop, not to crash it. Field-shape problems
 * (tests: 'oops', deviations: 42) are reported as findings naming the
 * violated rule, never exceptions. The only throw is a non-object props bag
 * (a caller mistake, E_INVALID_ARGUMENT).
 *
 * Codes (severity, rule):
 *   E_MISSING_TASK           error   task selection: no task declared
 *   E_MISSING_VERIFICATION   error   verification level: absent or 'none'
 *   E_NO_TESTS               error   required tests: none listed
 *   E_DEVIATION_UNJUSTIFIED  error   a deviation carries no justification
 *   W_NO_SKILLS              warn    skill usage: none listed
 *   W_LOGS_SPARSE            warn    logging completeness: absent or too thin
 *
 * DETERMINISM
 * Pure function of its input: fixed rule order, no clocks, no randomness.
 * The same props bag evaluates to a byte-identical findings array.
 *
 * Error type: reuses semantica/_internal.js SemanticaError (read-only).
 * No new error class is introduced.
 */

import { SemanticaError } from '../../../semantica/_internal.js';

/** Logging-completeness floor: a loop log below either bound is sparse. */
export const LOGS_MIN_LINES = 3;
export const LOGS_MIN_CHARS = 80;

/** Verification declaration that means "not actually verified". */
export const VERIFICATION_NONE = 'none';

const SEVERITIES = Object.freeze(['error', 'warn', 'info']);

function finding(code, severity, detail) {
  return { code, severity, detail };
}

/** Normalize logs (string or array of lines) into { lines, chars } or null. */
function measureLogs(logs) {
  if (logs === undefined || logs === null) return null;
  const lines = Array.isArray(logs) ? logs.map(String) : typeof logs === 'string' ? logs.split('\n') : null;
  if (lines === null) return null;
  const joined = lines.join('\n');
  return { lines, chars: joined.length, empty: joined.trim() === '' };
}

/** Non-empty string entries of a list field; null when the field is not a list. */
function entries(value) {
  if (!Array.isArray(value)) return null;
  return value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => typeof v === 'string' && v !== '');
}

/** Extract a deviation's `what` label and whether it carries a justification. */
function deviationState(deviation, index) {
  if (deviation && typeof deviation === 'object' && !Array.isArray(deviation)) {
    const what = typeof deviation.what === 'string' && deviation.what.trim() !== '' ? deviation.what.trim() : `#${index + 1}`;
    const justification = typeof deviation.justification === 'string' ? deviation.justification.trim() : '';
    return { what, justified: justification !== '' };
  }
  // A bare string IS the deviation description — it carries no justification.
  if (typeof deviation === 'string') {
    return { what: deviation.trim() !== '' ? deviation.trim() : `#${index + 1}`, justified: false };
  }
  return { what: `#${index + 1}`, justified: false };
}

/**
 * Evaluate one loop iteration against the policy. Returns { ok, findings };
 * findings are ordered by the fixed rule order (task, verification, tests,
 * deviations, skills, logs) so output is byte-identical for equal input.
 */
export function evaluate(props) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `evaluate props must be a plain object, got ${props === null ? 'null' : typeof props}`);
  }
  const { task, verification, tests, skills, logs, deviations } = props;
  const findings = [];

  // 1 — task selection
  if (typeof task !== 'string' || task.trim() === '') {
    findings.push(finding('E_MISSING_TASK', 'error', 'no task declared for this loop iteration'));
  }

  // 2 — verification level
  if (typeof verification !== 'string' || verification.trim() === '' || verification.trim() === VERIFICATION_NONE) {
    const seen = verification === undefined || verification === null ? 'absent' : JSON.stringify(String(verification));
    findings.push(finding('E_MISSING_VERIFICATION', 'error', `verification level ${seen}; declare a verification level (never '${VERIFICATION_NONE}')`));
  }

  // 3 — required tests
  const testList = entries(tests);
  if (testList === null) {
    findings.push(finding('E_NO_TESTS', 'error', `tests must be an array of test names, got ${tests === undefined ? 'undefined' : Array.isArray(tests) ? 'array' : typeof tests}`));
  } else if (testList.length === 0) {
    findings.push(finding('E_NO_TESTS', 'error', 'no tests listed; a loop iteration must name the tests that verify its work'));
  }

  // 4 — deviation justification (checked before skills/logs: error tier first)
  if (deviations !== undefined && deviations !== null && !Array.isArray(deviations)) {
    findings.push(finding('E_DEVIATION_UNJUSTIFIED', 'error', `deviations must be an array of { what, justification }, got ${typeof deviations}`));
  } else if (Array.isArray(deviations)) {
    deviations.forEach((deviation, index) => {
      const { what, justified } = deviationState(deviation, index);
      if (!justified) {
        findings.push(finding('E_DEVIATION_UNJUSTIFIED', 'error', `deviation "${what}" lacks a justification; every deviation from the plan must say why`));
      }
    });
  }

  // 5 — skill usage
  const skillList = entries(skills);
  if (skillList === null) {
    findings.push(finding('W_NO_SKILLS', 'warn', `skills must be an array of skill names, got ${skills === undefined ? 'undefined' : Array.isArray(skills) ? 'array' : typeof skills}`));
  } else if (skillList.length === 0) {
    findings.push(finding('W_NO_SKILLS', 'warn', 'no skills listed; check whether a library skill covers this task'));
  }

  // 6 — logging completeness
  const measured = measureLogs(logs);
  if (measured === null) {
    findings.push(finding('W_LOGS_SPARSE', 'warn', `logs must be a string or an array of lines, got ${logs === undefined ? 'undefined' : typeof logs}`));
  } else if (measured.empty) {
    findings.push(finding('W_LOGS_SPARSE', 'warn', 'no logs provided; a loop iteration must leave a log trail'));
  } else if (measured.lines.length < LOGS_MIN_LINES || measured.chars < LOGS_MIN_CHARS) {
    findings.push(finding('W_LOGS_SPARSE', 'warn', `logs sparse: ${measured.lines.length} line(s), ${measured.chars} char(s); a complete loop log has at least ${LOGS_MIN_LINES} lines / ${LOGS_MIN_CHARS} chars`));
  }

  // Severity sanity is structural: every finding this module emits uses the
  // declared vocabulary, so a malformed severity would be an authoring bug.
  for (const f of findings) {
    if (!SEVERITIES.includes(f.severity)) {
      throw new SemanticaError('E_INVALID_SEVERITY', `finding "${f.code}" carries undeclared severity "${f.severity}"`);
    }
  }

  return { ok: findings.length === 0, findings };
}
