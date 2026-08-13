/**
 * JEXI OS — Build 47: Task Registry.
 *
 * The single-slot `pendingTask` from stage 8 is upgraded to a PERSISTENT
 * multi-task registry: every distinct objective becomes a task with its own
 * status (active / paused / completed / failed), project, entities, plan,
 * completed + pending steps, decisions and last activity — so JEXI can:
 *
 *   - keep MULTIPLE subjects in flight ("frontend", "server", "math problem")
 *   - switch between them ("go back to the server") without losing state
 *   - resume interrupted work ("continue the first task")
 *   - resolve references ("it", "that", "the API", "task 2") against real
 *     task state instead of guessing
 *
 * Persisted to DATA_DIR/task-registry.json (survives restarts).
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const FILE = path.join(DATA_DIR, 'task-registry.json');
const MAX_TASKS = 60;

let tasks = load();

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) { /* fresh */ }
  return [];
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(tasks, null, 2), 'utf-8');
  } catch (e) { console.error('[TaskRegistry] persist error:', e.message); }
}

function now() { return Date.now(); }

let seq = tasks.reduce((m, t) => Math.max(m, Number(String(t.id || 'TASK-000').replace(/\D/g, '')) || 0), 0);

function nextId() {
  seq += 1;
  return `TASK-${String(seq).padStart(3, '0')}`;
}

const STATUS = ['active', 'paused', 'completed', 'failed'];

/* ------------------------------------------------------------------ */
/* Core API                                                            */
/* ------------------------------------------------------------------ */

/** Create a new task. Returns the task. */
export function createTask({ title, objective, project = '', entities = [], plan = [], status = 'active' }) {
  const t = {
    id: nextId(),
    title: String(title || 'Untitled objective').slice(0, 120),
    objective: String(objective || '').slice(0, 2000),
    project: String(project || '').slice(0, 120),
    status: STATUS.includes(status) ? status : 'active',
    entities: Array.isArray(entities) ? entities.map(String).slice(0, 20) : [],
    plan: Array.isArray(plan) ? plan.map(String).slice(0, 40) : [],
    completedSteps: [],
    pendingSteps: Array.isArray(plan) ? plan.map(String).slice(0, 40) : [],
    decisions: [],
    recentQueries: [],
    filesChanged: [],
    result: '',
    lastVerified: null,
    createdAt: now(),
    updatedAt: now(),
    lastActivity: now(),
    turnCount: 0,
  };
  tasks.unshift(t);
  if (tasks.length > MAX_TASKS) tasks = tasks.slice(0, MAX_TASKS);
  // Only one task is active at a time — starting a new one pauses the rest.
  for (const other of tasks) {
    if (other.id !== t.id && other.status === 'active') other.status = 'paused';
  }
  persist();
  return t;
}

export function getTask(id) {
  return tasks.find((t) => t.id === id) || null;
}

export function listTasks(statusFilter) {
  let out = tasks.slice();
  if (statusFilter) out = out.filter((t) => t.status === statusFilter);
  return out.sort((a, b) => b.lastActivity - a.lastActivity).map((t) => ({ ...t }));
}

/** Update fields on a task; bumps timestamps, keeps history in recentQueries. */
export function updateTask(id, patch = {}) {
  const t = getTask(id);
  if (!t) return null;
  if (patch.status) t.status = STATUS.includes(patch.status) ? patch.status : t.status;
  if (patch.title) t.title = String(patch.title).slice(0, 120);
  if (patch.objective) t.objective = String(patch.objective).slice(0, 2000);
  if (patch.project) t.project = String(patch.project).slice(0, 120);
  if (Array.isArray(patch.entities)) t.entities = [...new Set([...t.entities, ...patch.entities.map(String)]).values()].slice(0, 20);
  if (Array.isArray(patch.plan)) { t.plan = patch.plan.map(String).slice(0, 40); t.pendingSteps = patch.plan.map(String).slice(0, 40); }
  if (Array.isArray(patch.completedSteps)) t.completedSteps = [...new Set([...t.completedSteps, ...patch.completedSteps.map(String)].values())].slice(-60);
  if (Array.isArray(patch.pendingSteps)) t.pendingSteps = patch.pendingSteps.map(String).slice(0, 40);
  if (patch.query) {
    t.recentQueries.push(String(patch.query).slice(0, 300));
    t.recentQueries = t.recentQueries.slice(-10);
  }
  if (patch.result) t.result = String(patch.result).slice(0, 4000);
  if (patch.filesChanged) t.filesChanged = [...new Set([...t.filesChanged, ...(Array.isArray(patch.filesChanged) ? patch.filesChanged : [patch.filesChanged])].values())].slice(-40);
  if (patch.verified !== undefined) t.lastVerified = patch.verified ? now() : t.lastVerified;
  t.turnCount += 1;
  t.updatedAt = now();
  t.lastActivity = now();
  persist();
  return { ...t };
}

/** Add a decision to a task's decision log (with provenance, see DecisionMemory). */
export function addTaskDecision(id, decision) {
  const t = getTask(id);
  if (!t) return null;
  t.decisions.push({
    at: now(),
    ...(decision || {}),
  });
  t.decisions = t.decisions.slice(-30);
  persist();
  return { ...t };
}

export function deleteTask(id) {
  const before = tasks.length;
  tasks = tasks.filter((t) => t.id !== id);
  if (tasks.length !== before) persist();
  return { deleted: tasks.length !== before };
}

export function clearTasks() {
  tasks = [];
  persist();
  return { cleared: true };
}

export function taskStats() {
  const by = { active: 0, paused: 0, completed: 0, failed: 0 };
  for (const t of tasks) by[t.status] = (by[t.status] || 0) + 1;
  return { total: tasks.length, ...by };
}

/* ------------------------------------------------------------------ */
/* Reference resolution — "the server", "it", "task 2", "the frontend" */
/* ------------------------------------------------------------------ */

/** Pure continuation words — keep doing whatever we were doing. */
const CONTINUE_RE = /\b(continue|resume|go on|keep (going|working|it up)|proceed|carry on|pick (it |things )?up|again|move on)\b/i;
/** Switch language — return to an earlier subject ("go back to the server"). */
const SWITCH_RE = /\b(go back to|go back|back to|return to|switch back to|switch to|switch back|back on|back at)\b/i;
/** Task-id references: "task 1", "task-002", "the first task", "TASK-003". */
const TASK_ID_RE = /\btask[\s-]?#?0*(\d{1,3})\b/i;
/** Anaphoric pronouns that refer to what we were just doing. */
const ANAPHORA_RE = /\b(it|this|that|these|those|the other one)\b/i;
/** Action verbs that signal "do something to the referenced thing". */
const ACTION_RE = /\b(make|fix|change|improve|update|add|remove|build|create|write|show|explain|check|test|run|review|finish|complete|adjust|move|style|design|refactor|rename|delete|analyze|debug|extend|tweak|polish|push|deploy|setup|speed|faster|smaller|bigger)\b/i;
/** Standalone math/engineering topics that are NEVER a continuation. */
const MATH_TOPIC_RE = /(derivative|integral|solve|equation|calculate|compute|evaluate|velocity|acceleration|force|matrix|beam|stress|formula|probability|geometry|\d+\s*[+\-*/^]\s*\d|\d+\s*=\s*\d)/i;

/**
 * Score how strongly a message refers to a task by its title/entities/objective.
 * Returns 0..1 (1 = the task title appears verbatim).
 */
function titleMatch(query, task) {
  const q = String(query || '').toLowerCase();
  const title = String(task.title || '').toLowerCase();
  const obj = String(task.objective || '').toLowerCase();
  let score = 0;
  if (q.length >= 3 && title.length >= 3 && q.includes(title.slice(0, 20))) score = 1;
  // any entity from this task named in the query?
  for (const e of task.entities) {
    const en = String(e).toLowerCase();
    if (en.length >= 3 && q.includes(en)) score = Math.max(score, 0.85);
  }
  // strong singular nouns from the objective ("the server", "the api", "the website")
  for (const noun of ['server', 'api', 'frontend', 'backend', 'website', 'site', 'app', 'application', 'dashboard', 'script', 'program', 'project', 'design', 'theme', 'paper', 'article', 'analysis', 'simulation', 'controller', 'agent']) {
    if (new RegExp(`\\bthe ${noun}\\b|\\bthis ${noun}\\b|\\bthat ${noun}\\b|\\b${noun}\\b`).test(q) && obj.includes(noun)) score = Math.max(score, 0.6);
  }
  return score;
}

/**
 * Semantic match against titles/entities/objectives with tie detection:
 * "Fix the server" with TWO server tasks → ambiguous (candidates), never
 * silently picking one. Verbatim title hits (score 1) always win.
 */
function matchByName(q) {
  const scored = tasks
    .map((t) => ({ t, score: titleMatch(q, t) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score <= 0) return { resolved: false };
  if (top.score >= 1) {
    return { resolved: true, result: { taskId: top.t.id, confidence: 1, reason: `explicit reference to "${top.t.title}"` } };
  }
  // Entity/noun-level matches that TIE are ambiguous — ask instead of guessing.
  const ties = scored.filter((s) => s.score > 0.3 && s.score >= top.score - 0.1);
  if (ties.length >= 2) {
    return {
      resolved: true,
      result: {
        taskId: null,
        confidence: 0.4,
        reason: 'ambiguous reference (multiple matching tasks)',
        candidates: ties.slice(0, 3).map((s) => ({ id: s.t.id, title: s.t.title, status: s.t.status })),
      },
    };
  }
  return { resolved: true, result: { taskId: top.t.id, confidence: top.score, reason: `reference matched "${top.t.title}"` } };
}

/**
 * Resolve a message to a task id. Returns { taskId, confidence, reason }.
 * confidence > 0.55 is a safe match; between 0.3–0.55 is ambiguous (caller
 * should ask); below 0.3 means no reference (likely a new task).
 *
 * Resolution order: explicit task-id → named switch target ("go back to X") →
 * named title/entity match → continuation words (retry a failed task first,
 * else the most recent) → anaphoric reference ("make it faster") → ambiguous
 * fallbacks. Never invents a reference the message doesn't contain.
 */
export function resolveTaskRef(query) {
  const q = String(query || '').trim();
  if (!q) return { taskId: null, confidence: 0, reason: 'empty' };
  if (tasks.length === 0) return { taskId: null, confidence: 0, reason: 'no tasks yet' };

  // 1) Explicit task-id reference wins: "task 2", "the first task", "TASK-003".
  const idMatch = q.match(TASK_ID_RE);
  if (idMatch) {
    const n = parseInt(idMatch[1], 10);
    const byNumber = tasks.find((t) => Number(t.id.replace(/\D/g, '')) === n);
    if (byNumber) return { taskId: byNumber.id, confidence: 1, reason: `explicit ${byNumber.id} reference` };
    const byOrdinal = n === 1 ? tasks[0] : null; // "the first task" → most recent
    if (byOrdinal) return { taskId: byOrdinal.id, confidence: 0.8, reason: 'ordinal reference' };
  }

  // 2) Switch language: strip "go back to / return to" and resolve the NAMED
  //    target ("go back to the dashboard" → dashboard task, not the active one).
  if (SWITCH_RE.test(q)) {
    const sw = q.replace(SWITCH_RE, '').replace(/^[\s,.'"!?]+/, '').trim();
    if (sw && sw.length >= 3) {
      const m = matchByName(sw);
      if (m.resolved) return m.result;
    }
    // Bare "go back" — resume the most recent unfinished task.
    const ranked = [...tasks].sort((a, b) => b.lastActivity - a.lastActivity);
    const best = ranked.find((t) => t.status !== 'completed') || ranked[0];
    if (best) return { taskId: best.id, confidence: 0.8, reason: `switch → most recent task (${best.id})` };
  }

  // 3) Named title/entity match — checked BEFORE continuation words so
  //    "continue the equation we were solving" resolves to the equation task.
  const named = matchByName(q);
  if (named.resolved) return named.result;

  // 4) Pure continuation: a failed task is the retry target, else most recent.
  if (CONTINUE_RE.test(q)) {
    const failed = [...tasks].filter((t) => t.status === 'failed').sort((a, b) => b.lastActivity - a.lastActivity)[0];
    if (failed) return { taskId: failed.id, confidence: 0.85, reason: `continuation → retry failed task (${failed.id})` };
    const ranked = [...tasks].sort((a, b) => b.lastActivity - a.lastActivity);
    if (ranked[0]) return { taskId: ranked[0].id, confidence: 0.9, reason: `continuation → most recent task (${ranked[0].id})` };
  }

  // 5) Anaphoric reference + action verb ("make it faster", "fix that") — but
  //    never for a standalone math/engineering topic ("solve this equation").
  if (ANAPHORA_RE.test(q) && ACTION_RE.test(q) && !MATH_TOPIC_RE.test(q)) {
    const ranked = [...tasks].sort((a, b) => b.lastActivity - a.lastActivity);
    if (ranked[0]) return { taskId: ranked[0].id, confidence: 0.7, reason: `anaphoric reference → most recent task (${ranked[0].id})` };
  }

  // 6) Weak partial candidates + anaphoric pronoun → ambiguous.
  const scored = tasks.map((t) => ({ t, score: titleMatch(q, t) })).sort((a, b) => b.score - a.score);
  if (scored.length >= 2 && scored[1].score > 0.3 && ANAPHORA_RE.test(q)) {
    return {
      taskId: null,
      confidence: 0.4,
      reason: 'ambiguous reference',
      candidates: scored.filter((s) => s.score > 0.3).slice(0, 3).map((s) => ({ id: s.t.id, title: s.t.title, status: s.t.status })),
    };
  }

  return { taskId: null, confidence: 0, reason: 'no task reference' };
}

/** Build a compact resume-context block for a task (injected into planning). */
export function taskContextBlock(task, { maxSteps = 12, maxDecisions = 4 } = {}) {
  if (!task) return '';
  const lines = [];
  lines.push(`Current task: ${task.id} — ${task.title} (${task.status})`);
  if (task.project) lines.push(`Project: ${task.project}`);
  if (task.objective) lines.push(`Objective: ${task.objective.slice(0, 400)}`);
  if (task.completedSteps.length) lines.push(`Completed: ${task.completedSteps.slice(-maxSteps).join(' → ')}`);
  if (task.pendingSteps.length) lines.push(`Remaining: ${task.pendingSteps.slice(0, maxSteps).join(' → ')}`);
  if (task.decisions.length) {
    lines.push(`Decisions made: ${task.decisions.slice(-maxDecisions).map((d) => String(d.content || d).slice(0, 120)).join(' | ')}`);
  }
  if (task.filesChanged.length) lines.push(`Files touched: ${task.filesChanged.slice(-8).join(', ')}`);
  if (task.lastVerified) lines.push(`Last verified: ${new Date(task.lastVerified).toISOString()}`);
  return lines.join('\n');
}
