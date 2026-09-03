/**
 * B209 — THE SUPERVISOR: JEXI watching an employee work, LIVE.
 *
 * "She should be able to observe the work and decide: this approach isn't
 * working — stop, look elsewhere." This module makes that real, on the
 * token stream, while the employee is still generating:
 *
 *   observe(token)  — fed every token as it arrives; deterministic watchers
 *                     run on the rolling buffer (loop, refusal, secret leak,
 *                     runaway length, stalled stream). Zero model cost,
 *                     always on, for EVERY employee.
 *
 *   checkpoint     — ONE bounded model review per assignment (lead
 *   review           assignments by default): at the first natural
 *                    checkpoint (~600 chars of draft) JEXI reads the draft
 *                    against the objective and may redirect.
 *
 * When a watcher or the review decides the work is off-track, the
 * supervisor fires onDecision({ action: 'REDIRECT', instruction, reason })
 * — the EmployeeSession aborts using that output, tells the employee via a
 * RECOVERY message, and restarts the assignment with the redirect
 * instruction. Redirects are bounded (default 1) so supervision can never
 * loop. A late decision after the work finished is ignored.
 *
 * Nothing here is theater: every redirect corresponds to a real observed
 * condition in the actual stream, and every one is evented.
 */

const DEFAULTS = {
  loopMinRepeat: 3,       // same ≥12-char signature repeated this many times in the tail
  runawayChars: 26000,    // more than this and the employee is writing a novel, not working
  stallMs: 75000,         // tokens started flowing, then silence for this long → stalled
  checkpointChars: 600,   // draft length that triggers the (single) LLM review
  maxRedirects: 1,        // hard bound — supervision must never loop
};

/** Deterministic stream watchers (no model, no cost, always on). */
export function streamWatchers(buffer, opts = {}) {
  const tail = buffer.slice(-600);
  // 1. degenerate loop: a 12-40 char unit TILED back-to-back 3+ times in
  // the tail (the true degenerate signature; a phrase merely recurring in
  // prose does not fire)
  if (tail.length >= 60) {
    const minRepeat = opts.loopMinRepeat || DEFAULTS.loopMinRepeat;
    const m = tail.match(new RegExp(`([\\s\\S]{12,40}?)\\1{${Math.max(1, minRepeat - 1)},}`));
    if (m && m[1].trim().length >= 12) {
      return { action: 'REDIRECT', reason: 'stuck in a repetition loop', instruction: 'You are repeating yourself. Stop, and deliver the structured output (REPORT / DELIVERABLE / CONFIDENCE / CLAIMS) cleanly and completely.' };
    }
    if (/(.)\1{40,}/.test(tail)) {
      return { action: 'REDIRECT', reason: 'degenerate character repetition', instruction: 'Your output degenerated. Redo the assignment and deliver the structured output.' };
    }
  }
  // 2. live refusal detection (the post-hoc gate exists; this catches it mid-stream)
  if (/as an ai,? i (can'?t|cannot|won'?t)|i'?m sorry,? but i can'?t/i.test(tail)) {
    return { action: 'REDIRECT', reason: 'the employee started refusing instead of working', instruction: 'Do the assigned work. If you genuinely lack a capability or information, say exactly what you need in a ## NEEDS section — do not refuse wholesale.' };
  }
  // 3. secret / model-identity leak (never let infrastructure ids into work product)
  if (/(api[_-]?key|secret|bearer)\s*[:=]\s*[\w-]{8,}/i.test(tail) || /\b(sk-[a-zA-Z0-9]{16,}|ghp_[a-zA-Z0-9]{20,}|rnd_[a-zA-Z0-9]{20,})\b/.test(tail)) {
    return { action: 'REDIRECT', reason: 'a credential pattern appeared in the output', instruction: 'Your draft contained a credential or secret pattern. Redo the work WITHOUT any keys, tokens, secrets, or provider/model identifiers.' };
  }
  // 4. runaway length
  if (buffer.length > (opts.runawayChars || DEFAULTS.runawayChars)) {
    return { action: 'REDIRECT', reason: 'the draft far exceeds any useful length', instruction: 'You have written far more than the assignment needs. Wrap up NOW and deliver the structured output concisely.' };
  }
  return null;
}

export class Supervisor {
  /**
   * @param {object} p
   *   objective, criteria, employeeName
   *   review: async ({draft}) => ({redirect: boolean, instruction: string}) | null  (injectable; production = one LLM call)
   *   onDecision: (decision) => void  — fired at most maxRedirects times
   *   onEvent: (evt) => void          — supervision events (SUPERVISION_*)
   *   liveReview: boolean             — enable the checkpoint LLM review (lead assignments)
   */
  constructor(p = {}) {
    this.objective = String(p.objective || '');
    this.criteria = p.criteria || [];
    this.employeeName = String(p.employeeName || 'the employee');
    this.review = typeof p.review === 'function' ? p.review : null;
    this.onDecision = typeof p.onDecision === 'function' ? p.onDecision : null;
    this.onEvent = typeof p.onEvent === 'function' ? p.onEvent : () => {};
    this.liveReview = p.liveReview !== false;
    this.buffer = '';
    this.started = false;
    this.finished = false;
    this.redirects = 0;
    this.maxRedirects = p.maxRedirects ?? DEFAULTS.maxRedirects;
    this.reviewStarted = false;
    this.reviewDone = false;
    this._stallTimer = null;
    this._stallMs = p.stallMs || DEFAULTS.stallMs;
    this._checkpointChars = p.checkpointChars || DEFAULTS.checkpointChars;
    this.leakDetected = false;
  }

  /** Every token from the live stream passes through here. */
  observe(token) {
    if (this.finished || !token) return;
    const chunk = String(token);
    this.buffer += chunk;
    if (!this.started) {
      this.started = true;
      this._armStall();
    } else {
      this._resetStall();
    }
    // deterministic watchers on every token: the checks are cheap regexes
    // over a 600-char tail — a fast short stream (a one-line refusal) must
    // be caught live, not only after a throttle window elapses
    const leak = /(api[_-]?key|secret|bearer)\s*[:=]\s*[\w-]{8,}/i.test(this.buffer) || /\b(sk-[a-zA-Z0-9]{16,}|ghp_[a-zA-Z0-9]{20,}|rnd_[a-zA-Z0-9]{20,})\b/.test(this.buffer);
    if (leak && !this.leakDetected) {
      this.leakDetected = true;
      this.onEvent({ type: 'SUPERVISION_FLAG', summary: `A credential pattern appeared in ${this.employeeName}'s draft — it will be redacted before delivery.`, severity: 'warn' });
    }
    const d = streamWatchers(this.buffer);
    if (d) this.decide(d);
    // the single checkpoint review
    if (this.review && this.liveReview && !this.reviewDone && !this.reviewStarted
        && this.buffer.length >= this._checkpointChars) {
      this.reviewStarted = true;
      this._runReview();
    }
  }

  _runReview() {
    const draft = this.buffer.slice(0, 4000);
    Promise.resolve(this.review({ objective: this.objective, criteria: this.criteria, draft }))
      .then((r) => {
        this.reviewDone = true;
        if (r && r.redirect) {
          this.decide({
            action: 'REDIRECT',
            reason: r.reason || 'the approach is off-track for the objective',
            instruction: r.instruction || 'Stop the current approach and address the objective directly.',
          });
        } else if (r) {
          this.onEvent({ type: 'SUPERVISION_CHECKPOINT', summary: `Checkpoint review: ${this.employeeName}'s approach is on track.`, severity: 'info' });
        }
      })
      .catch(() => { this.reviewDone = true; /* review failure never blocks the work */ });
  }

  /** Fire a decision (bounded — supervision itself must never loop). */
  decide(decision) {
    if (this.finished) return; // work already completed; the verifier is the backstop
    if (this.redirects >= this.maxRedirects) return;
    this.redirects += 1;
    this.onEvent({
      type: 'SUPERVISION_REDIRECT',
      summary: `${this.employeeName}: ${decision.reason}. I'm stopping that approach and re-instructing rather than letting it run.`,
      severity: 'warn',
      instruction: decision.instruction,
    });
    try { this.onDecision?.(decision); } catch { /* the race rejector handles the rest */ }
  }

  /** Generation completed normally — disarms everything; late reviews are ignored. */
  finish() {
    this.finished = true;
    this._clearStall();
  }

  _armStall() {
    this._clearStall();
    this._stallTimer = setTimeout(() => {
      this.decide({
        action: 'REDIRECT',
        reason: 'the output stream stalled mid-generation',
        instruction: 'Your generation stalled. Redeliver the complete structured output.',
      });
    }, this._stallMs);
    // a timer must never keep the process alive
    if (this._stallTimer.unref) this._stallTimer.unref();
  }

  _resetStall() { this._clearStall(); this._armStall(); }
  _clearStall() { if (this._stallTimer) { clearTimeout(this._stallTimer); this._stallTimer = null; } }
}
