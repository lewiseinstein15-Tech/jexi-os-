/**
 * JEXI OS — Phase 17 Scope B — AGENT LOOP.
 *
 *   observe → think → act   (repeat until done or the step budget runs out)
 *
 * Ported from browser-use's `Agent.run`/`Agent.step` cycle. The shape:
 *
 *   observe()  take a DOM snapshot through DomService → indexed element list
 *   think()    hand the snapshot + history to a model, get back ONE action
 *   act()      dispatch that action through the ActionRegistry with real CDP
 *
 * ── THE MODEL IS INJECTABLE ────────────────────────────────────────────────
 * The loop does not bundle an LLM client. `think` calls a `decide` function:
 *
 *     decide({ snapshot, history, task, step }) -> { action, input, reasoning }
 *
 * Supply a real model, a scripted planner, or a human. The loop is identical
 * in every case, which is what makes the probe reproducible: a `ScriptedDecider`
 * drives the same code path a model would, so a probe failure is a real loop
 * failure, not a mocked-out success.
 *
 * ── ELEMENT INDEXING ───────────────────────────────────────────────────────
 * Snapshot text carries stable indices and `*` prefixes for newly seen
 * elements (see dom-service.js). The decider picks an index; the loop resolves
 * it against the live page at act time, so a stale index fails with a specific
 * `E_ELEMENT_UNKNOWN_INDEX` instead of clicking the wrong thing.
 *
 * ── FAILURE IS A FIRST-CLASS RESULT ────────────────────────────────────────
 * A failing action is recorded in the history with its error, and the loop
 * continues (up to `maxConsecutiveFailures`). It never swallows an error to
 * report a clean run, and it never reports `finished` unless the decider asked
 * to finish or a declared goal check passed.
 */

import { DomService, formatSnapshot } from './dom-service.js';
import { createActionRegistry } from './actions/index.js';
import { installDialogShim } from './actions/dialogs.js';

/** A decider that replays a fixed script — used by probes and tests. */
export class ScriptedDecider {
  /**
   * @param {Array<{action: string, input?: object, reasoning?: string}>} script
   * @param {object} [o]
   * @param {boolean} [o.finishWhenDone] emit `finish` after the script runs out
   */
  constructor(script, { finishWhenDone = true } = {}) {
    this.script = [...script];
    this.step_index = 0;
    this.finishWhenDone = finishWhenDone;
  }

  /** @param {{snapshot: object, history: Array, step: number}} ctx */
  async decide({ step }) {
    const next = this.script[step];
    if (!next) {
      return this.finishWhenDone
        ? { action: 'finish', input: { reason: 'script exhausted' }, reasoning: 'all scripted steps completed' }
        : { action: 'wait', input: { seconds: 0.1 }, reasoning: 'script exhausted, idling' };
    }
    return { action: next.action, input: next.input || {}, reasoning: next.reasoning || null };
  }
}

/**
 * The loop.
 */
export class BrowserAgent {
  /**
   * @param {object} o
   * @param {import('./cdp.js').CdpSession} o.session
   * @param {(ctx: object) => Promise<object>} o.decide      the model/planner
   * @param {object} [o.registry]                            ActionRegistry (default: safe permissions)
   * @param {DomService} [o.dom]
   * @param {number} [o.maxSteps]
   * @param {number} [o.maxConsecutiveFailures]
   * @param {(event: object) => void} [o.onEvent]            step observer for probes/logs
   * @param {boolean} [o.installDialogShim]
   */
  constructor({
    session,
    decide,
    registry = null,
    dom = null,
    maxSteps = 25,
    maxConsecutiveFailures = 3,
    onEvent = null,
    installDialogShim: wantShim = true,
    outputDir = null,
  } = {}) {
    if (!session) throw new Error('BrowserAgent: a CDP session is required');
    if (typeof decide !== 'function') throw new Error('BrowserAgent: a decide function is required');
    this.session = session;
    this.decide = decide;
    this.registry = registry || createActionRegistry();
    this.dom = dom || new DomService();
    this.maxSteps = maxSteps;
    this.maxConsecutiveFailures = maxConsecutiveFailures;
    this.onEvent = onEvent;
    this.wantShim = wantShim;
    this.outputDir = outputDir;
    this.history = [];
    this.dialogShim = null;
  }

  _emit(event) {
    if (this.onEvent) { try { this.onEvent(event); } catch { /* observer must not break the loop */ } }
  }

  /** observe: snapshot the DOM into an indexed element list. */
  async observe() {
    const started = Date.now();
    const snapshot = await this.dom.extract(this.session);
    this._emit({ phase: 'observe', ms: Date.now() - started, elements: snapshot.elements.length, new_count: snapshot.new_count, url: snapshot.url, title: snapshot.title });
    return snapshot;
  }

  /**
   * act: run one action through the registry.
   * @returns {{ok: boolean, result?: object, error?: object}}
   */
  async act(step) {
    const ctx = {
      session: this.session,
      client: this.session.client,
      dom: this.dom,
      agent: this,
      outputDir: this.outputDir,
      step,
    };
    const started = Date.now();
    try {
      const envelope = await this.registry.dispatch(step.action, step.input || {}, ctx);
      // An action may hand back a new session (new_tab / switch_tab).
      if (ctx.session !== this.session) this.session = ctx.session;
      this._emit({ phase: 'act', action: step.action, input: step.input, ok: true, ms: Date.now() - started, result: envelope.result });
      return { ok: true, result: envelope.result, ms: envelope.ms };
    } catch (e) {
      this._emit({ phase: 'act', action: step.action, input: step.input, ok: false, ms: Date.now() - started, error: { name: e.name, code: e.code, message: e.message } });
      return { ok: false, error: { name: e.name, code: e.code || null, message: e.message } };
    }
  }

  /**
   * Run the observe → think → act cycle.
   *
   * @param {string} task                   natural-language task, given to the decider
   * @param {object} [o]
   * @param {(finalState: object) => (boolean|Promise<boolean>)} [o.goalCheck]
   *        when supplied, `finish` is only reported as achieved if this returns true
   * @returns {Promise<object>} a run report — every step recorded, nothing hidden
   */
  async run(task, { goalCheck = null } = {}) {
    const runStarted = Date.now();
    let consecutiveFailures = 0;
    let finished = false;
    let finishReason = null;
    let goalAchieved = null;

    if (this.wantShim) {
      try {
        this.dialogShim = await installDialogShim(this.session);
        this._emit({ phase: 'setup', dialog_shim: this.dialogShim });
      } catch (e) {
        this.dialogShim = { installed: false, error: e.message };
        this._emit({ phase: 'setup', dialog_shim: this.dialogShim });
      }
    }

    for (let stepIndex = 0; stepIndex < this.maxSteps && !finished; stepIndex++) {
      const snapshot = await this.observe();

      let decision;
      try {
        decision = await this.decide({
          snapshot,
          snapshot_text: snapshot.text,
          task,
          step: stepIndex,
          history: this.history,
        });
      } catch (e) {
        this._emit({ phase: 'think', step: stepIndex, error: { name: e.name, message: e.message } });
        return {
          task, finished: false, steps: this.history.length, history: this.history,
          reason: `the decider threw: ${e.message}`,
          goal_achieved: null, elapsed_ms: Date.now() - runStarted,
        };
      }

      if (!decision || !decision.action) {
        return {
          task, finished: false, steps: this.history.length, history: this.history,
          reason: 'the decider returned no action',
          goal_achieved: null, elapsed_ms: Date.now() - runStarted,
        };
      }

      this._emit({ phase: 'think', step: stepIndex, action: decision.action, input: decision.input, reasoning: decision.reasoning });

      if (decision.action === 'finish') {
        finished = true;
        finishReason = decision.input?.reason || decision.reasoning || 'the decider finished the task';
        goalAchieved = goalCheck ? await goalCheck({ session: this.session, dom: this.dom, history: this.history, snapshot }) : null;
        this.history.push({ step: stepIndex, phase: 'think', action: 'finish', input: decision.input || {}, reasoning: decision.reasoning || null, ok: true });
        break;
      }

      const outcome = await this.act(decision);
      this.history.push({
        step: stepIndex,
        action: decision.action,
        input: decision.input || {},
        reasoning: decision.reasoning || null,
        ok: outcome.ok,
        result: outcome.ok ? outcome.result : null,
        error: outcome.ok ? null : outcome.error,
        url: await this.session.eval('location.href').catch(() => null),
        ms: outcome.ms,
      });

      if (outcome.ok) consecutiveFailures = 0;
      else {
        consecutiveFailures++;
        if (consecutiveFailures >= this.maxConsecutiveFailures) {
          return {
            task, finished: false, steps: this.history.length, history: this.history,
            reason: `stopped after ${consecutiveFailures} consecutive action failures`,
            goal_achieved: null, elapsed_ms: Date.now() - runStarted,
          };
        }
      }
    }

    const final = await this.session.pageInfo().catch(() => ({}));
    return {
      task,
      finished,
      finish_reason: finishReason,
      goal_achieved: goalAchieved,
      steps: this.history.length,
      history: this.history,
      final_url: final.url,
      final_title: final.title,
      elapsed_ms: Date.now() - runStarted,
      action_metrics: this.registry.report(),
    };
  }
}

/**
 * Convenience: build an agent over a session.
 */
export function createAgent(session, decide, o = {}) {
  return new BrowserAgent({ session, decide, ...o });
}


/**
 * Phase 17 Scope C — compose deciders with explicit priority WITHOUT touching
 * the OpenHands loop or its DOM decider semantics. The first decider that
 * resolves to a plan wins; a decider contributes a "cannot decide" by
 * returning null/undefined or throwing.
 *
 *   const decide = chainDeciders([domDecider, visionDecider]);
 *   const agent = createAgent(session, decide);
 *
 * The chained plan is annotated with `decided_by` (index/position) and, if the
 * losing decider explained its refusal, `alternatives` — so a run log shows
 * WHY vision took over a step.
 */
export function chainDeciders(deciders) {
  if (!Array.isArray(deciders) || deciders.length === 0) {
    throw new Error('chainDeciders: at least one decider is required');
  }
  return async function chained(ctx) {
    const attempts = [];
    for (let i = 0; i < deciders.length; i++) {
      const d = deciders[i];
      let plan = null, err = null;
      try { plan = await d(ctx); } catch (e) { err = e; }
      if (plan) {
        return {
          ...plan,
          decided_by: plan.decided_by ?? (d.name || `decider[${i}]`),
          alternatives: attempts.length ? attempts : undefined,
        };
      }
      attempts.push({
        decider: d.name || `decider[${i}]`,
        refused: err ? String(err.code || err.message) : 'no plan',
      });
    }
    const e = new Error(`no decider produced a plan (attempted ${deciders.length}); refusals: ${attempts.map((a) => `${a.decider}=${a.refused}`).join(', ')}`);
    e.code = 'E_NO_DECISION';
    e.attempts = attempts;
    throw e;
  };
}

export { DomService, formatSnapshot, createActionRegistry, installDialogShim };
export default { BrowserAgent, createAgent, ScriptedDecider, DomService, createActionRegistry, chainDeciders };
