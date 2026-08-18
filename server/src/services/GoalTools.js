/**
 * B132 — GOAL TOOLS (DeepSeek Harness `packages/goal/tool-goal` mirror).
 *
 * The model drives goals itself mid-conversation with optimistic
 * concurrency (DSH revisions):
 *   get_goal()            → the current goal + exact revision (or none)
 *   create_goal({objective, max_goal_rounds?}) → {goal_id, revision}
 *   update_goal({goal_id, revision, action: edit|pause|resume|complete|blocked,
 *                objective?, max_goal_rounds?, blocking_condition?})
 *
 * The goal record is owned HERE (persisted) — independent of the background
 * GoalEngine's async lifecycle — exactly like DSH's tool-goal state.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { writeFileAtomic } from './AtomicWrite.js';

const GOAL_ID_KEY = 'jexi-active-goal';
const STATE_FILE = path.join(DATA_DIR, 'goal-tools.json');

let state = null;

function load() {
  if (state) return state;
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); } catch { state = { goal: null }; }
  if (!state || typeof state !== 'object') state = { goal: null };
  return state;
}

function save() {
  try { writeFileAtomic(STATE_FILE, JSON.stringify(state)); } catch { /* noop */ }
}

export function getCurrentGoal() {
  const goal = load().goal;
  return goal
    ? { ok: true, goal: { id: String(goal.id || GOAL_ID_KEY), revision: Number(goal.revision || 1), objective: String(goal.objective || '').slice(0, 500), status: String(goal.status || 'running'), max_goal_rounds: Number(goal.maxRounds || 0) || null } }
    : { ok: true, goal: null };
}

export function createGoal({ objective, max_goal_rounds }) {
  const text = String(objective || '').trim();
  if (!text) return { ok: false, error: 'objective required (the concrete completion goal)' };
  const st = load();
  st.goal = {
    id: GOAL_ID_KEY,
    objective: text.slice(0, 500),
    revision: 1,
    status: 'running',
    maxRounds: Number(max_goal_rounds) > 0 ? Math.min(Number(max_goal_rounds), 12) : 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  save();
  return { ok: true, goal_id: GOAL_ID_KEY, revision: 1, objective: text.slice(0, 500), started: true };
}

export function updateGoal({ goal_id, revision, action, objective, max_goal_rounds, blocking_condition }) {
  if (String(goal_id || '') !== GOAL_ID_KEY) return { ok: false, error: `unknown goal_id ${goal_id}` };
  const st = load();
  const goal = st.goal;
  if (!goal) return { ok: false, error: 'no active goal to update — call create_goal first' };
  const rev = Number(revision);
  if (!Number.isInteger(rev) || rev < 1) return { ok: false, error: 'revision required (exact value from get_goal)' };
  if (rev !== Number(goal.revision || 1)) {
    return { ok: false, error: `revision mismatch: goal is at revision ${goal.revision}, got ${rev} — call get_goal and retry with the exact revision` };
  }
  const actions = ['edit', 'pause', 'resume', 'complete', 'blocked'];
  if (!actions.includes(String(action || ''))) return { ok: false, error: `action must be one of ${actions.join(', ')}` };

  if (action === 'edit') {
    if (!objective) return { ok: false, error: 'objective required with action edit' };
    goal.objective = String(objective).slice(0, 500);
    if (Number(max_goal_rounds) > 0) goal.maxRounds = Math.min(Number(max_goal_rounds), 12);
    goal.status = 'running';
  } else if (action === 'pause') goal.status = 'paused';
  else if (action === 'resume') goal.status = 'running';
  else if (action === 'complete') goal.status = 'done';
  else if (action === 'blocked') {
    goal.status = 'blocked';
    goal.blockedReason = String(blocking_condition || '').slice(0, 300);
  }
  goal.revision = rev + 1;
  goal.updatedAt = Date.now();
  save();

  const statusMap = { edit: 'running', complete: 'done', blocked: 'blocked', pause: 'paused', resume: 'running' };
  return { ok: true, goal_id: GOAL_ID_KEY, revision: rev + 1, action, status: statusMap[action] || 'running' };
}
