/**
 * JEXI OS — AGENT — CodingLoop.
 *
 * The closed loop for "fix the failing test", split out of AgentLoop.
 *
 * JEXI-002 — the verification subsystem existed and was correct
 * (verifyAfterEdit returns a structured injectedFailure) but NOTHING called it:
 * an edit landed, the turn ended on model prose, and there was no exit code or
 * verifier evidence to contradict it. This module wires that in.
 *
 * JEXI-008 — the CODE state machine: EDIT → VERIFY → (fail) INJECT evidence +
 * REPLAN → EDIT … → (pass) → allow a success claim.
 *
 * JEXI-009 — final success used to be whatever the model wrote; now a coding
 * turn without a real green verification is reported `unverified`.
 *
 * JEXI-013 — `context.injectedFailure` is consumed (fed back to the model)
 * rather than dropped, and the round budget bounds the replanning.
 *
 * The module is pure with respect to the model — it takes `runVerify` and
 * `send` — so the whole state machine is unit-testable with no API key.
 */

/** Tools whose success implies the workspace changed and must be verified. */
export const MUTATING_TOOLS = new Set(['fs_write', 'fs_edit', 'fs_append', 'fs_delete', 'fs_patch']);

/** Test tools count as verification on their own — but only when they pass. */
export const TEST_TOOLS = new Set(['test_run', 'pytest_run', 'test_coverage', 'run_tests']);

/* M21 — coding-turn heuristic split out to keep this file small (JEXI-016). */
export { CODING_INTENTS, isCodingIntent } from './intent.js';

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
import { readVerdict, isFailingVerdict } from './test-verdict.js';
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
    this.unverifiable = false;    // M21 — no applicable layer checked the edit
    /** JEXI-002 — a test tool that ran and came back NOT green. The gate used
     *  to look only at `editSeen`, so "ran pytest, watched it fail, changed
     *  nothing, narrated a fix" graded not_applicable/true. Red is red whether
     *  or not an edit accompanied it. */
    this.failingTest = null;
    /** M15 — EVIDENCE-GROUNDED COMPLETION. A turn whose every tool attempt
     *  failed, or a coding turn that produced no evidence at all, must not be
     *  reported as a success. Previously "read the file and summarised it"
     *  rode on one failed `fs_read` and was graded not_applicable/true. */
    this.failedCalls = [];        // { tool, error } for attempts that did NOT complete
    this.succeededCalls = [];     // tools that actually completed this turn
    this.evidenceRequired = false; // set by AgentLoop for a coding-intent turn
    return this;
  }

  /** Did this call change the workspace? */
  noteToolCall(name, ok, info = {}) {
    if (ok === false) {
      this.failedCalls.push({ tool: String(name || ''), error: info.error || info.reason || null, blocked: info.blocked === true });
    } else {
      this.succeededCalls.push({ tool: String(name || '') });
    }
    if (MUTATING_TOOLS.has(name) && ok !== false) this.editSeen = true;
  }

  /**
   * Record what a test tool actually returned. Transport success is NOT a
   * passing suite (pytest_run returns ok:true with status:'fail' when red) —
   * the red case must survive into the success gate, not be laundered.
   */
  noteTestResult(name, result, meta = null) {
    // M17/D1 — the reader prefers typed metadata, else the legacy object.
    const verdict = readVerdict(name, result, meta);
    if (verdict) { this.failingTest = verdict; this.pendingFailure = this.pendingFailure ?? verdict; }
    else if (meta?.kind === 'test' || !isFailingVerdict(result?.status)) this.failingTest = null;   // green clears red
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

    /* M21 — nothing applicable could check the edit. Do NOT inject a failure:
       a "fix this" prompt with no defect drove the model to rewrite the same
       file to the iteration cap. */
    if (outcome?.unverifiable === true || outcome?.context?.unverifiable === true) {
      this.unverifiable = true;
      this.pendingFailure = null;
      this.send('agent.log', { message: `ℹ️ no applicable verification layer — the edit stands but is UNVERIFIED.` });
      return { verified: false, unverifiable: true, failure: null, results, round: this.rounds.length };
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
    if (this.editSeen) {
      if (this.verified) {
        return { status: 'verified', canClaimSuccess: true, annotation: null, reason: 'a real verification layer returned pass' };
      }
      /* M21 — nothing applicable could check the edit: honest `unverifiable`,
         NOT a failure claim and NOT a success claim. */
      if (this.unverifiable) {
        return { status: 'unverifiable', canClaimSuccess: false, reason: 'no applicable verification layer', annotation: '[UNVERIFIED] A change was made but no verification layer applies here, so it could not be confirmed.' };
      }
      if (this.budgetExhausted) {
        return { status: 'unverified', canClaimSuccess: false, reason: 'verification budget exhausted without a pass', annotation: '[UNVERIFIED] The edits in this turn were never confirmed by a passing test run. The failure is reported above.' };
      }
      return { status: 'unverified', canClaimSuccess: false, reason: this.pendingFailure?.reason || 'no verification pass was produced', annotation: '[UNVERIFIED] A change was made but no verification layer returned a pass, so this is not a confirmed fix.' };
    }
    /* M15 — EVIDENCE-GROUNDED COMPLETION.
       No edit landed, so there is nothing to verify — but that is NOT the same
       as "the turn succeeded". A tool call that failed and was NEVER retried
       successfully is an unresolved failure: the outcome the caller asked for
       did not happen (e.g. `fs_read` on a missing file, then "I have
       summarised it"). A successful call of the SAME tool later in the turn
       resolves it — a probe that fails before the real read is normal and must
       not be punished. A plain answer with no tool use stays
       not_applicable/true: asking a question is not a completion claim. */
    const unresolved = this.failedCalls.filter((f) => !this.succeededCalls.some((s) => s.tool === f.tool));
    if (unresolved.length) {
      const names = [...new Set(unresolved.map((c) => c.tool))].join(', ');
      const first = unresolved.find((c) => c.error) || unresolved[0];
      const allFailed = !this.succeededCalls.length;
      return {
        status: 'unverified',
        canClaimSuccess: false,
        reason: allFailed
          ? `every tool call this turn failed (${names})`
          : `tool call(s) failed and were never retried successfully (${names})`,
        annotation: `[UNVERIFIED] ${allFailed ? 'Every tool call in this turn failed' : 'A tool call in this turn failed and was not successfully retried'} (${names})${first?.error ? ` — ${String(first.error).slice(0, 200)}` : ''}. No outcome was produced, so nothing here is a confirmed result.`,
      };
    }
    if (this.evidenceRequired && !this.succeededCalls.length) {
      return {
        status: 'unverified',
        canClaimSuccess: false,
        reason: 'the task required tool evidence and none was produced',
        annotation: '[UNVERIFIED] This task required real tool evidence and the turn produced none — no file was written, no test ran, nothing was confirmed.',
      };
    }
    return { status: 'not_applicable', canClaimSuccess: true, annotation: null, reason: 'no mutating tool call in this turn' };
  }
}

/* M21 — result shaping moved to ./tool-result.js (JEXI-016 size guard). */
export { shapeToolResult } from './tool-result.js';
