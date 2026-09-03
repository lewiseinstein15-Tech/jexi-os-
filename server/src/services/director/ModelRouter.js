/**
 * B208 — MODEL ROUTER: the bridge between an EMPLOYEE and the models that
 * power them. The router's single most important rule:
 *
 *   FALLBACK NEVER CHANGES THE EMPLOYEE.
 *   If a provider dies mid-task, the employee gets a different model —
 *   and keeps working under the same name, role and history.
 *
 *   employee → capability needs → preference order → provider → model
 *
 * The preference order comes from (1) the task type's hint table below,
 * (2) live telemetry (recent provider success rates), (3) the global
 * provider order as the final neutral fallback. Adding a provider is a
 * one-line change in PROVIDER_LADDER (the LLM client already speaks to
 * every configured provider).
 *
 * Events (via the callback the caller passes): MODEL_SELECTED,
 * MODEL_SWITCHED — the switch event always names the EMPLOYEE as who
 * continues, with the new provider as secondary metadata only.
 */

import { telemetry } from './Telemetry.js';

/** Which provider family leads for a task type (data, not code). '' = neutral. */
const TASK_HINTS = {
  research: 'openrouter',
  search: 'groq',
  synthesis: '',
  code: 'groq',
  verification: 'gemini',
  security: 'groq',
  planning: 'gemini',
  memory: '',
  data: 'openrouter',
  design: 'openrouter',
  reasoning: 'gemini',
  report: '',
};

/** Every provider family the LLM client can speak to, in rough capability order. */
const PROVIDER_LADDER = ['groq', 'openrouter', 'gemini', 'deepinfra', 'cerebras', 'mistral', 'xai', 'huggingface'];

/**
 * Build the preference order for an employee session:
 * hint first, then the rest ranked by live reliability. De-duped.
 */
export function preferenceOrder(taskType) {
  const hint = TASK_HINTS[taskType] || '';
  const rest = telemetry.rankProviders(PROVIDER_LADDER.filter((p) => p !== hint));
  const order = [];
  for (const p of [hint, ...rest, '']) if (p !== undefined && !order.includes(p)) order.push(p);
  return order; // '' (neutral order) is always last
}

export class ModelSession {
  constructor(employee, taskType, opts = {}) {
    this.employee = employee;             // identity — NEVER changes for the session
    this.taskType = taskType;
    this.order = opts.order || preferenceOrder(taskType);
    this.attempt = 0;                     // which rung of the ladder we're on
    this.switchCount = 0;
    this.providerUsed = null;
  }

  /** Current rung: the `prefer` value the LLM client should receive. */
  get prefer() { return this.order[Math.min(this.attempt, this.order.length - 1)]; }

  get providerLabel() {
    const p = this.prefer || 'auto';
    return p === 'auto' ? 'Automatic' : p.charAt(0).toUpperCase() + p.slice(1);
  }

  /** Advance one rung. Returns true if a fallback remains, false if exhausted. */
  switchModel() {
    if (this.attempt >= this.order.length - 1) return false;
    this.attempt += 1;
    this.switchCount += 1;
    return true;
  }

  /** Session descriptor for events/UI: employee primary, model secondary. */
  describe() {
    return {
      agentId: this.employee.agentId,
      displayName: this.employee.displayName,
      provider: this.prefer || 'auto',
      providerLabel: this.providerLabel,
      attempt: this.attempt,
      switchCount: this.switchCount,
    };
  }
}

/**
 * Run an employee's model work with the fallback ladder.
 *
 * @param {object} employee    the identity (from Employees.js)
 * @param {string} taskType    capability hint for provider preference
 * @param {Function} work      async ({session, prefer, attempt}) => result
 * @param {object} hooks       { onEvent(evt), onToken(t, meta) }
 * @returns the work result
 * @throws the LAST error after the ladder is exhausted (typed EmployeeError)
 */
export async function runWithModel(employee, taskType, work, hooks = {}) {
  const emit = (type, data) => { try { hooks.onEvent?.({ type, ...data }); } catch { /* never break */ } };
  const session = new ModelSession(employee, taskType);
  emit('MODEL_SELECTED', {
    agentId: employee.agentId, agentName: employee.displayName,
    summary: `${employee.displayName} is on the ${session.providerLabel} lane.`,
    data: session.describe(),
  });

  let lastErr = null;
  while (true) {
    const t0 = Date.now();
    emit('MODEL_REQUEST_STARTED', { agentId: employee.agentId, agentName: employee.displayName, summary: `${employee.displayName} is working (lane: ${session.providerLabel}).` });
    try {
      const result = await work({ session, prefer: session.prefer, attempt: session.attempt });
      const ms = Date.now() - t0;
      telemetry.record('provider', session.prefer || 'auto', { ok: true, ms });
      session.providerUsed = session.prefer || 'auto';
      emit('MODEL_REQUEST_COMPLETED', { agentId: employee.agentId, agentName: employee.displayName, summary: `${employee.displayName} finished a model pass in ${(ms / 1000).toFixed(1)}s.` });
      return result;
    } catch (err) {
      lastErr = err;
      telemetry.record('provider', session.prefer || 'auto', { ok: false, ms: Date.now() - t0 });
      const retryable = isProviderError(err);
      if (!retryable || !session.switchModel()) break;
      // THE IDENTITY RULE: the employee continues — only the lane changes.
      emit('MODEL_SWITCHED', {
        agentId: employee.agentId, agentName: employee.displayName,
        summary: `${employee.displayName}'s current model is unavailable — switching her to a compatible fallback and continuing.`,
        data: session.describe(),
      });
    }
  }
  const e = new Error(lastErr ? lastErr.message : 'model work failed');
  e.code = 'PROVIDER_FAILED';
  e.lastError = lastErr?.message;
  throw e;
}

/** Does this error look like a provider/infra failure (vs bad output)? */
export function isProviderError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (err?.code === 'PROVIDER_FAILED' || err?.code === 'TIMEOUT') return true;
  return /rate|quota|429|503|timeout|econn|fetch failed|network|all ai providers failed|overloaded|internal server|api key/.test(msg);
}
