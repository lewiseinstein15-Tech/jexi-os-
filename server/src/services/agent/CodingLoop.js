/**
 * JEXI OS — AGENT — CodingLoop.
 *
 * The closed loop for "fix the failing test", split out of AgentLoop.
 *
 * JEXI-002 — the verification subsystem existed and was correct
 * (verifyAfterEdit returns a structured injectedFailure), but NOTHING in the
 * chat loop called it. An edit landed and the turn ended on model prose:
 * "I've fixed the bug." No exit code, no verifier, no evidence. The
 * "definition of done" in the roadmap required a real exit code and verifier
 * evidence, and the loop could not produce either.
 *
 * JEXI-008 — the loop was generic: plan → tool_calls → execute → model answer.
 * There was no CODE state machine. This module IS that state machine:
 *
 *     EDIT  → VERIFY → (fail) INJECT evidence + REPLAN → EDIT …
 *           → (pass) → allow the turn to claim success
 *
 * JEXI-009 — final success used to be whatever the model wrote. Now a coding
 * turn that has not produced at least one real green verification is reported
 * as `unverified`, and the answer is annotated so a "fixed it" claim cannot
 * ride on prose alone.
 *
 * JEXI-013 — verifyAfterEdit could return `context.injectedFailure` and
 * AgentLoop simply dropped it. Here it is consumed: the structured failure is
 * appended to the messages fed back to the model and the loop continues with
 * a replan, and the budget is decremented so it cannot spin forever.
 *
 * The module is pure with respect to the model: it takes a `runVerify`
 * function and a `send` callback. That makes the whole state machine
 * unit-testable with no API key — see tests/tickets/jexi-002-008-009-013.
 */

/** Tools whose success implies the workspace changed and must be verified. */
export const MUTATING_TOOLS = new Set(['fs_write', 'fs_edit', 'fs_append', 'fs_delete', 'fs_patch']);

/** Test tools count as verification on their own — but only when they pass. */
export const TEST_TOOLS = new Set(['test_run', 'pytest_run', 'test_coverage', 'run_tests']);

/** Intents that must not be answered without real verification evidence. */
export const CODING_INTENTS = new Set(['code', 'coding', 'fix', 'debug', 'refactor', 'test']);

/** Is this query a coding request by intent or by its own words? */
export function isCodingIntent(plan, query = '') {
  const intent = String(plan?.intent ?? '').toLowerCase();
  if (CODING_INTENTS.has(intent)) return true;
  return /\b(fix|repair|make .* pass|failing (test|pytest)|broken|bug|debug|refactor|implement|add a test)\b/i.test(String(query));
}

/* JEXI-030 — the coding tool set. A turn that is going to read a failing
   test, edit a module and re-run pytest needs these and almost nothing else.
   Membership is by PREFIX so a newly registered fs_* tool is covered without
   touching this list. */
export const CODING_TOOL_PREFIXES = ['fs_', 'term_', 'test_', 'pytest_', 'git_', 'run_test', 'code_'];

export function isCodingTool(name) {
  const n = String(name || '').toLowerCase();
  if (n.startsWith('mcp__')) return false;
  return CODING_TOOL_PREFIXES.some((p) => n === p || n.startsWith(p));
}

export function isCodingToolSchema(schema) {
  const n = schema?.name || schema?.function?.name || '';
  if (!n) return false;
  return isCodingTool(n);
}

// JEXI-018 — the chat closed loop runs tests through the SAME seam the
// WorkGraph verifier uses. Exported so a test can assert identity rather than
// infer it: `CodingLoop.runTestEvidence === TestVerifier.runTestEvidence`.
import { runTestEvidence } from '../../verification/verifiers/TestVerifier.js';
import { readTestVerdict, isFailingVerdict } from './test-verdict.js';
export { runTestEvidence };

export class CodingLoop {
  /**
   * @param {object} o
   * @param {(ctx:object)=>Promise<{ok:boolean, context?:object, results?:object[]}>} o.runVerify
   * @param {(type:string, payload:object)=>void} [o.send]  same signature as AgentLoop's emit
   * @param {number} [o.maxVerifyRounds=4]       hard cap on edit→verify→replan cycles
   */
  constructor({ runVerify, send = () => {}, maxVerifyRounds = 4 } = {}) {
    if (typeof runVerify !== 'function') throw new TypeError('CodingLoop requires a runVerify function');
    this.runVerify = runVerify;
    this.send = send;
    this.maxVerifyRounds = maxVerifyRounds;
    this.reset();
  }

  reset() {
    /** @type {{layer:string,status:string,reason?:string,evidence?:object[]}[]} */
    this.rounds = [];
    this.pendingFailure = null;   // JEXI-013 — consumed by the next model turn
    this.verified = false;        // JEXI-009 — at least one real PASS
    this.editSeen = false;        // JEXI-002 — did this turn actually change anything?
    this.budgetExhausted = false;
    /** JEXI-002 — a test tool that ran and came back NOT green. The old gate
     *  only looked at `editSeen`, so a turn that ran pytest, watched it fail,
     *  changed nothing, and then narrated a fix was graded `not_applicable`
     *  with canClaimSuccess=true. Red output is red output whether or not an
     *  edit accompanied it. */
    this.failingTest = null;
    return this;
  }

  /** Did this call change the workspace? */
  noteToolCall(name, ok) {
    if (MUTATING_TOOLS.has(name) && ok !== false) this.editSeen = true;
  }

  /**
   * Record what a test tool actually returned.
   *
   * A test tool "succeeding" at the transport level is not a passing suite —
   * `pytest_run` returns ok:true with result.status:'fail' when the suite is
   * red. That distinction is the whole point: the red case must survive into
   * the success gate instead of being laundered into a success.
   */
  noteTestResult(name, result) {
    const verdict = readTestVerdict(name, result);
    if (verdict) { this.failingTest = verdict; this.pendingFailure = this.pendingFailure ?? verdict; }
    else if (!isFailingVerdict(result?.status)) this.failingTest = null;   // green clears red
    return this;
  }

  /**
   * Run one verification pass after a mutating call.
   *
   * Returns { verified, failure, results, round }. `failure` is non-null only
   * when verification actually ran and did not pass — it is the structured
   * object that must be injected into the next model turn.
   */
  async verify(reason = 'edit') {
    if (this.rounds.length >= this.maxVerifyRounds) {
      this.budgetExhausted = true;
      this.send('agent.log', { message: `⏹ verification budget spent (${this.maxVerifyRounds} rounds) — stopping with an honest failure report rather than claiming success.` });
      return { verified: false, failure: { layer: 'budget', reason: `verification budget exhausted after ${this.maxVerifyRounds} rounds` }, results: [], round: this.rounds.length };
    }

    let outcome;
    try {
      outcome = await this.runVerify({ reason });
    } catch (e) {
      // A verifier that throws is a FAILURE, never a pass.
      outcome = { ok: false, context: { verified: false, injectedFailure: { layer: 'verifier', reason: (e && e.message) || 'verifier threw' } }, results: [] };
    }

    const results = outcome?.results ?? [];
    this.rounds.push(...results);

    if (outcome?.ok === true) {
      this.verified = true;
      this.pendingFailure = null;
      this.send('agent.log', { message: `✅ verification passed after ${reason} (${results.map((r) => r.layer).join(', ') || 'ok'}).` });
      return { verified: true, failure: null, results, round: this.rounds.length };
    }

    const failure = outcome?.context?.injectedFailure ?? { layer: 'unknown', reason: 'verification failed with no structured failure' };
    this.pendingFailure = failure;                 // JEXI-013 — do not drop it
    this.send('agent.log', { message: `❌ verification failed after ${reason} (${failure.layer}): ${String(failure.reason ?? '').slice(0, 200)} — replanning with this evidence.` });
    return { verified: false, failure, results, round: this.rounds.length };
  }

  /**
   * The text handed to the model on the NEXT turn when verification failed.
   * Structured, not a vibe: the failing layer, the reason, the raw evidence
   * tail, and an explicit instruction not to claim success.
   */
  failureMessage() {
    const f = this.pendingFailure;
    if (!f) return null;
    const evidence = (f.evidence ?? []).map((e) => String(e.content ?? '').slice(-1500)).join('\n---\n');
    return [
      `[VERIFICATION FAILED — layer: ${f.layer}]`,
      `reason: ${f.reason ?? 'unknown'}`,
      evidence ? `evidence:\n${evidence}` : '',
      '',
      'The change you just made did not pass verification. Read the real output above,',
      'form a new hypothesis, and make a DIFFERENT change. Do not repeat the previous',
      'edit. Do not claim the task is fixed. If you cannot fix it, say exactly what is',
      'still failing and why.',
    ].filter(Boolean).join('\n');
  }

  /**
   * JEXI-009 — may this turn claim the work is done?
   *
   * A coding turn that edited something and never produced a green verify is
   * NOT allowed to be reported as a success; it is `unverified`, and the
   * answer gets an explicit annotation.
   */
  successGate() {
    /* JEXI-002 — a test tool that ran and came back RED blocks the success
       claim on its own, before the editSeen check. Without this, "I looked at
       the failing suite, edited nothing, and here is what I would do" was
       graded not_applicable/true — an unverified turn reported as success. */
    if (this.failingTest) {
      return {
        status: 'unverified',
        canClaimSuccess: false,
        reason: this.failingTest.reason,
        annotation: `[UNVERIFIED] ${this.failingTest.tool} ran in this turn and did not pass (${this.failingTest.reason}). Nothing here is a confirmed fix.`,
      };
    }
    if (!this.editSeen) {
      return { status: 'not_applicable', canClaimSuccess: true, annotation: null, reason: 'no mutating tool call in this turn' };
    }
    if (this.verified) {
      return { status: 'verified', canClaimSuccess: true, annotation: null, reason: 'a real verification layer returned pass' };
    }
    if (this.budgetExhausted) {
      return { status: 'unverified', canClaimSuccess: false, reason: 'verification budget exhausted without a pass', annotation: '[UNVERIFIED] The edits in this turn were never confirmed by a passing test run. The failure is reported above.' };
    }
    return { status: 'unverified', canClaimSuccess: false, reason: this.pendingFailure?.reason || 'no verification pass was produced', annotation: '[UNVERIFIED] A change was made but no verification layer returned a pass, so this is not a confirmed fix.' };
  }
}

/** JEXI-014 — tool results were sliced to a flat 6000 chars, which cut the
 *  pytest traceback (always at the END of the output) off exactly when it
 *  mattered. This keeps a head AND a tail, with the tail biased toward the
 *  assertion/failure lines. */
export function shapeToolResult(text, { maxChars = 6000, isTestResult = false } = {}) {
  const s = String(text ?? '');
  if (s.length <= maxChars) return s;
  const headChars = Math.floor(maxChars * 0.3);
  const tailChars = maxChars - headChars - 120;
  const head = s.slice(0, headChars);
  const tail = s.slice(-tailChars);
  const elided = s.length - head.length - tail.length;

  if (isTestResult) {
    // Put the structured failure lines first so they survive any later slicing.
    const lines = s.split('\n');
    const signal = lines
      .filter((l) => /^(FAILED|ERROR)\s|^E\s+|^>+\s|\bassert\b|Traceback|short test summary|^\d+ (passed|failed)|\d+ failed,|\d+ passed,/.test(l))
      .slice(0, 60);
    const signalBlock = signal.length ? `\n\n--- key lines (failures/assertions) ---\n${signal.join('\n')}\n` : '';
    return `${head}\n\n…[${elided} chars elided]…${signalBlock}\n--- tail ---\n${tail}`;
  }
  return `${head}\n\n…[${elided} chars elided — the failure detail is in the tail below]…\n\n${tail}`;
}
