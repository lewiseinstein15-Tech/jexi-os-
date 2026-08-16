/**
 * JEXI OS — Goal Engine (autonomous task execution).
 *
 * Turns a user GOAL ("book me a flight", "research X and build Y", "plan my
 * trip and email it to me") into an autonomous run that:
 *
 *   1. PLANS the goal (Planner intent + team).
 *   2. ASKS FOR WHAT IT NEEDS — under Full autonomy, a preflight pass asks the
 *      planner which details it requires (dates, cities, budget, accounts…)
 *      and parks the goal until the user answers. One structured question
 *      round instead of guessing.
 *   3. EXECUTES with the graph + bounded loops, with ALL confirmations
 *      auto-approved (the user pre-authorized this goal), while destructive /
 *      irreversible actions still respect the real RiskGuard + EXTERNAL-tier
 *      classification unless the goal explicitly covers them.
 *   4. LOOPS AT THE GOAL LEVEL — if a run fails, it retries ONCE with the
 *      failure + the last error injected (FAILURE → HISTORY → CORRECT → VERIFY),
 *      the same pattern the per-node loops use.
 *   5. REPORTS — streams everything live and returns a final report: what ran,
 *      what was approved automatically, what was asked, what was skipped.
 *
 * Autonomy levels (per goal, per session):
 *   'ask'  (default) — today's behavior: pause at every confirmation.
 *   'full'           — user said "go": preflight questions once, then run to
 *                      completion, auto-approving confirmations for THIS goal.
 *                      Still refuses what RiskGuard/Guardrail block.
 *
 * The engine is dependency-injected (planner / orchestrator / generateContent)
 * so the autonomy logic is unit-testable without live keys.
 */

import { z } from 'zod';

/** Autonomy levels the engine understands. */
export const AUTONOMY_LEVELS = ['ask', 'full'];

const MAX_GOAL_ATTEMPTS = 2; // plan-level retry with failure context (bounded loop)
const MAX_STORED_GOALS = 50;

const QUESTIONS_SCHEMA = z.object({
  questions: z.array(z.object({ field: z.string(), question: z.string() })).max(6).default([]),
}).passthrough();

export class GoalEngine {
  /**
   * @param {object} deps
   * @param {object} deps.planner       — { analyzeIntent }
   * @param {object} deps.orchestrator  — { executePlan }
   * @param {function} [deps.generateContent] — (prompt, system, image, opts) => Promise<string>
   * @param {object} [deps.store]       — { saveRun, loadRun, clearRun } (SessionStore subset)
   */
  constructor(deps = {}) {
    this.planner = deps.planner;
    this.orchestrator = deps.orchestrator;
    this.generateContent = deps.generateContent || null;
    this.store = deps.store || null;
    this.goals = new Map(); // id → goal record
  }

  /** Live goal records (newest first, bounded). */
  listGoals() {
    return [...this.goals.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_STORED_GOALS)
      .map((g) => this.publicGoal(g));
  }

  goal(id) {
    const g = this.goals.get(id);
    return g ? this.publicGoal(g) : null;
  }

  publicGoal(g) {
    return {
      id: g.id,
      goal: g.goal,
      session: g.session,
      autonomy: g.autonomy,
      status: g.status, // running | need-info | done | failed
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      attempts: g.attempts,
      infoRequests: g.infoRequests,
      autoApprovals: g.autoApprovals.length,
      result: g.result || null,
      error: g.error || null,
    };
  }

  /**
   * Start a goal. Returns immediately with either:
   *   { needInfo: [...questions] }           — parked, waiting for answers
   *   { result: <orchestrator results> }     — completed synchronously
   * (The caller streams `sendEvent` lines during the run.)
   */
  async startGoal({ goal, session = 'default', autonomy = 'ask', sendEvent = () => {}, providedInfo = null, unattended = false }) {
    const level = AUTONOMY_LEVELS.includes(autonomy) ? autonomy : 'ask';
    const emit = (type, data) => { try { sendEvent(type, data); } catch { /* noop */ } };

    const id = `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const record = {
      id,
      goal: String(goal || '').trim(),
      session,
      autonomy: level,
      unattended: Boolean(unattended), // scheduled/background runs: never park
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: 0,
      infoRequests: [],
      autoApprovals: [],
      result: null,
      error: null,
    };
    this.goals.set(id, record);
    if (this.goals.size > MAX_STORED_GOALS * 2) {
      // prune oldest completed/failed first, then oldest any
      const order = [...this.goals.keys()].sort((a, b) => (this.goals.get(a).createdAt - this.goals.get(b).createdAt));
      for (const k of order) {
        if (this.goals.size <= MAX_STORED_GOALS) break;
        const g = this.goals.get(k);
        if (g.status === 'done' || g.status === 'failed') this.goals.delete(k);
      }
    }

    emit('goal.start', { goalId: id, autonomy: level, unattended: record.unattended, goal: record.goal });

    try {
      const plan = await this.planner.analyzeIntent(record.goal, {});
      emit('goal.plan', { goalId: id, intent: plan.intent, complexity: plan.complexity, steps: plan.steps || [] });

      // FULL autonomy → preflight questions once. UNATTENDED runs (scheduled
      // goals) SKIP questions entirely — there is no one to answer, so asking
      // would park the job forever. Defaults + auto-approval are used instead.
      if (level === 'full' && !record.unattended) {
        const questions = await this.askWhatItNeeds(record.goal, plan);
        if (questions.length && !providedInfo) {
          record.status = 'need-info';
          record.updatedAt = Date.now();
          record.infoRequests = questions;
          emit('goal.need-info', { goalId: id, questions });
          emit('log', { agent: 'JEXI', message: `📋 To do this autonomously I need a few details:\n${questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}\n\nType your answers (or say "use defaults" and I'll proceed with what I know).` });
          return { goalId: id, needInfo: questions };
        }
        if (providedInfo) {
          record.infoRequests = questions; // for the record
          emit('goal.info-provided', { goalId: id, answer: String(providedInfo).slice(0, 400) });
        }
      } else if (record.unattended) {
        emit('log', { agent: 'Goal Engine', message: '⚙️ Scheduled run — no question pass (unattended). Using defaults and auto-approving confirmations for this goal.' });
      }

      const result = await this.runWithRetry(record, plan, providedInfo, emit);
      record.result = result;
      record.status = result.success === false ? 'failed' : 'done';
      record.updatedAt = Date.now();
      if (this.store) this.store.clearRun(record.session);
      return { goalId: id, result };
    } catch (e) {
      record.status = 'failed';
      record.error = (e && e.message) || String(e);
      record.updatedAt = Date.now();
      emit('goal.failed', { goalId: id, error: record.error });
      return { goalId: id, error: record.error };
    }
  }

  /**
   * Resume a parked (need-info) goal with the user's answers.
   * `answer` is the raw text; it is injected as context for the run.
   * `fallback` ({ goal, autonomy }) re-creates the engine record when the
   * process restarted (the in-memory goals map is gone, but the job queue
   * persisted the goal text).
   */
  async resumeWithInfo({ goalId, session, answer, sendEvent = () => {}, fallback = null }) {
    let g = this.goals.get(goalId);
    if (!g && fallback && fallback.goal) {
      g = {
        id: goalId,
        goal: String(fallback.goal).trim(),
        session,
        autonomy: AUTONOMY_LEVELS.includes(fallback.autonomy) ? fallback.autonomy : 'ask',
        status: 'need-info',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
        infoRequests: [],
        autoApprovals: [],
        result: null,
        error: null,
      };
      this.goals.set(goalId, g);
    }
    if (!g) return { ok: false, error: 'goal not found' };
    if (g.status !== 'need-info') return { ok: false, error: `goal is not waiting for info (status: ${g.status})` };
    const emit = (type, data) => { try { sendEvent(type, data); } catch { /* noop */ } };
    emit('goal.resuming', { goalId, goal: g.goal });

    try {
      const plan = await this.planner.analyzeIntent(g.goal, {});
      const result = await this.runWithRetry(g, plan, String(answer || ''), emit);
      g.result = result;
      g.status = result.success === false ? 'failed' : 'done';
      g.updatedAt = Date.now();
      if (this.store) this.store.clearRun(session);
      return { goalId: g.id, result };
    } catch (e) {
      g.status = 'failed';
      g.error = (e && e.message) || String(e);
      g.updatedAt = Date.now();
      return { goalId: g.id, error: g.error };
    }
  }

  /** Park a mid-run graph pause so /api/chat can resume it (ask mode). */
  async _parkRun(record, plan, query, pausedState) {
    if (this.store && pausedState) {
      this.store.saveRun(record.session, { plan, query, state: pausedState });
    }
    record.status = 'need-info';
    record.updatedAt = Date.now();
    const payload = pausedState && pausedState.confirmationPayload;
    if (payload && payload.question) {
      record.infoRequests = [{ field: 'confirmation', question: payload.question }];
    }
  }

  /**
   * Goal-level bounded loop: run the plan; if it fails and we have attempts
   * left, re-run ONCE with the failure + last error injected as context
   * (FAILURE → HISTORY → CORRECT → VERIFY at the goal level).
   */
  async runWithRetry(record, plan, infoContext, emit) {
    let attempt = 0;
    let lastError = '';
    let query = record.goal;

    while (attempt < MAX_GOAL_ATTEMPTS) {
      attempt += 1;
      record.attempts = attempt;
      record.updatedAt = Date.now();
      emit('goal.attempt', { goalId: record.id, attempt, max: MAX_GOAL_ATTEMPTS });

      const effQuery = attempt > 1 && lastError
        ? `${query}\n\n[Goal retry ${attempt} — the previous run failed with: ${lastError}. Diagnose the cause, fix it, and complete the goal.]`
        : query;

      const opts = {
        // Full autonomy pre-authorizes THIS goal: confirmations resolve
        // automatically; the graph still honors RiskGuard/Guardrail blocks.
        // Unattended (scheduled) runs ALWAYS auto-approve — there is no human
        // to ask, so pausing would deadlock the schedule.
        autoConfirm: record.autonomy === 'full' || record.unattended,
        onPause: async (pausedState) => {
          await this._parkRun(record, plan, effQuery, pausedState);
          record.status = 'need-info';
          record.updatedAt = Date.now();
          emit('goal.paused', { goalId: record.id, question: (pausedState && pausedState.confirmationPayload && pausedState.confirmationPayload.question) || 'Confirmation needed.' });
        },
      };

      const results = await this.orchestrator.executePlan(plan, effQuery, emit, opts);

      // Auto-approval bookkeeping (what the graph decided on its own).
      if (Array.isArray(opts._autoApprovals) && opts._autoApprovals.length) {
        for (const p of opts._autoApprovals) {
          if (p && p.question) record.autoApprovals.push(String(p.question).slice(0, 200));
        }
        if (record.autoApprovals.length) {
          emit('goal.approvals', { goalId: record.id, count: record.autoApprovals.length, questions: record.autoApprovals.slice(-5) });
        }
      }

      // Paused at a confirmation (ask mode / info needed) — park and wait.
      if (record.status === 'need-info') {
        return { ...results, parked: true, needInfo: record.infoRequests };
      }

      if (results && results.success !== false) {
        return results;
      }

      lastError = (results && (results.error || '')) || 'unknown failure';
      if (attempt >= MAX_GOAL_ATTEMPTS) {
        return results;
      }
      // No keys / all providers down: retrying cannot help — fail honestly
      // instead of burning another pass.
      if (/No API keys configured|All AI providers failed/.test(lastError)) {
        return results;
      }
      emit('log', { agent: 'Goal Engine', message: `↻ Attempt ${attempt} failed (${String(lastError).slice(0, 160)}) — retrying with the failure injected.` });
    }
    return { success: false, error: lastError, summary: `### ⚠ JEXI OS\n\nThe goal could not be completed after ${MAX_GOAL_ATTEMPTS} attempts. Last error: ${lastError}` };
  }

  /**
   * Preflight: ask the planner which details it needs to execute this goal.
   * ONE LLM call; on failure / no keys → no questions (never blocks the goal).
   */
  async askWhatItNeeds(goal, plan) {
    if (!this.generateContent) return [];
    try {
      const prompt = `You are the preflight planner for an autonomous agent. The user gave this GOAL:\n"${String(goal).slice(0, 1000)}"\n\nPlanned intent: ${plan.intent}. Team: ${(plan.steps || []).join(', ') || 'general'}.\n\nTo execute this goal END-TO-END without pausing, what personal details do you GENUINELY need from the user? STRICT RULES:\n- Ask ONLY for blocking facts the agent cannot know or infer: specific dates, cities/flights, budgets, account handles, contact/email addresses.\n- NEVER ask about preferences that have sensible defaults (depth, tone, region, count, time range, sources). Default those.\n- Ask at most 3 questions. Prefer 0-1. If everything can be defaulted, ask nothing.\n\nReply with STRICT JSON only: {"questions": [{"field": "short_key", "question": "one clear question"}]}. Max 3 questions. If nothing is needed, reply {"questions": []}.`;
      const raw = await this.generateContent(prompt, 'You output strict JSON only.', null, { prefer: 'groq', temperature: 0.2 });
      const parsed = JSON.parse(String(raw || '').replace(/```json|```/g, '').trim());
      const checked = QUESTIONS_SCHEMA.safeParse(parsed);
      return checked.success ? checked.data.questions : [];
    } catch {
      return [];
    }
  }
}

/** Shared singleton used by the API layer. */
export const goalEngine = new GoalEngine();
