/**
 * JEXI OS — REQUEST BUDGET MANAGER (AGI Phase 1, increment 2).
 *
 * Model calls are a limited resource (spec §13/§39). Every task may carry a
 * budget: maximum model calls, tokens, wall-clock time, retries, and (when
 * prices are known) cost. The budget is consumed as work happens and can be
 * queried — never silently exceeded without the caller finding out.
 *
 * Deterministic, keyless, persisted nowhere (budgets live for the life of a
 * task; the mission's own persistence covers restarts).
 */

const clampInt = (n, dflt) => (Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt);

export class TaskBudget {
  constructor({ maxModelCalls = 40, maxTokens = 200_000, maxRetries = 12, wallClockMs = 10 * 60_000, maxCost = null, label = 'task' } = {}) {
    this.label = String(label).slice(0, 80);
    this.limits = {
      maxModelCalls: clampInt(maxModelCalls, 40),
      maxTokens: clampInt(maxTokens, 200_000),
      maxRetries: clampInt(maxRetries, 12),
      wallClockMs: clampInt(wallClockMs, 10 * 60_000),
      maxCost: maxCost == null ? null : Number(maxCost),
    };
    this.used = { modelCalls: 0, tokens: 0, retries: 0, cost: 0 };
    this.startedAt = Date.now();
    this.exhaustedReason = null;
    this._blocked = [];
  }

  /** Consume one model call (+ observed token count). Throws nothing. */
  consume({ tokens = 0, cost = 0, retry = false } = {}) {
    if (retry) this.used.retries += 1;
    this.used.modelCalls += 1;
    this.used.tokens += Math.max(0, Number(tokens) || 0);
    this.used.cost += Math.max(0, Number(cost) || 0);
    return this.remaining();
  }

  /** What's left, and whether the budget allows another call. */
  remaining() {
    return {
      modelCalls: Math.max(0, this.limits.maxModelCalls - this.used.modelCalls),
      tokens: Math.max(0, this.limits.maxTokens - this.used.tokens),
      retries: Math.max(0, this.limits.maxRetries - this.used.retries),
      ms: Math.max(0, this.limits.wallClockMs - (Date.now() - this.startedAt)),
      cost: this.limits.maxCost == null ? null : Math.max(0, this.limits.maxCost - this.used.cost),
    };
  }

  /**
   * Can another call be made? Records the FIRST exhausted reason (never
   * silently resets). `why` explains exactly which limit ran out.
   */
  canSpend({ tokens = 0 } = {}) {
    const r = this.remaining();
    const reasons = [];
    if (r.modelCalls <= 0) reasons.push('model calls exhausted');
    if (r.tokens <= Math.max(0, Number(tokens) || 0)) reasons.push('token budget exhausted');
    if (r.retries <= 0) reasons.push('retry budget exhausted');
    if (r.ms <= 0) reasons.push('wall-clock budget exhausted');
    if (this.limits.maxCost != null && r.cost <= 0) reasons.push('cost budget exhausted');
    if (reasons.length) {
      if (!this.exhaustedReason) this.exhaustedReason = reasons.join(' + ');
      return { ok: false, why: this.exhaustedReason, remaining: r };
    }
    return { ok: true, why: null, remaining: r };
  }

  /** Human/JSON summary for events and the dashboard. */
  snapshot() {
    return { label: this.label, limits: this.limits, used: { ...this.used }, elapsedMs: Date.now() - this.startedAt, remaining: this.remaining(), exhaustedReason: this.exhaustedReason };
  }
}

/** Wrap an llm-style function so every call consumes from a budget. */
export function withBudget(budget, fn) {
  if (!budget || typeof budget.canSpend !== 'function') return fn;
  return async (...args) => {
    const gate = budget.canSpend();
    if (!gate.ok) throw new Error(`Budget exhausted (${budget.label}): ${gate.why}`);
    const out = await fn(...args);
    const text = typeof out === 'string' ? out : (out && out.text) || '';
    budget.consume({ tokens: Math.ceil(String(text).length / 4) }); // ~4 chars/token estimate, honest approximation
    return out;
  };
}
