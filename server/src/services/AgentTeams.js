/**
 * B160 — AGENT TEAMS (DeepSeek Harness `packages/experimental/agent-team`
 * mirror): implicit-root team domain — a flat Lead/teammate roster, a durable
 * peer mailbox, and a shared versioned task DAG.
 *
 * Fidelity notes (from the DSH subsystem catalog):
 *   - Every conversation root is the implicit LEAD of a team keyed by its id;
 *     creating a team is state-free until the first member/message/task.
 *   - Teammate names: lowercase kebab-case ≤ 64 chars, immutable, NEVER
 *     reusable (maxMembers counts every name ever provisioned, including
 *     failed members — DSH rule).
 *   - Mailbox: durable queued→delivered records, FIFO per target, delivery
 *     begins `Team message <id> from <name>:`, per-target pending cap (64),
 *     framed byte cap (64 KB). De-dup: a message id is never re-delivered.
 *   - Task board: complete VERSIONED snapshots; every mutation carries
 *     expectedRevision — a stale writer gets TEAM_TASK_STALE_REVISION, never
 *     a silent overwrite. ids are `task-<n>`. Dependencies must form a DAG
 *     over live tasks (no self/duplicate edges); a pending task is READY only
 *     when every blocker completed. Deleted tasks stay as tombstones for
 *     replay/id-stability but leave the maxTasks budget.
 *   - waitForChange(): waits for one roster/task/mailbox/status edge after
 *     registration, bounded 10 s…1 h, reports only whether it timed out.
 *
 * JEXI port: teammates are continuable subagent slots driven by the existing
 * SubagentRuntime; the team service owns the durable SHAPES (roster, mailbox,
 * DAG) exactly like ctx.agentTeams, and the model-facing tools live in
 * server/plugins/agent-team (tool-agent-team mirror).
 */

import crypto from 'crypto';

export const TEAM_LIMITS = {
  maxMembers: 8,
  maxTasks: 256,
  maxPendingMessagesPerMember: 64,
  maxMessageBytes: 65536,
};

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHANGE_KEYS = ['roster', 'task', 'mailbox', 'status'];

class Team {
  constructor(id) {
    this.id = id;
    this.members = new Map();     // name → member record
    this.inbox = new Map();       // member name → [message records]
    this.leadLog = [];            // durable lead-session records
    this.tasks = new Map();       // task id → versioned snapshot (or tombstone)
    this.nextTaskId = 1;
    this.version = 0;             // one monotone change counter
    this.waiters = [];            // { sinceVersion, resolve, timer }
  }
  bump(kind) {
    this.version += 1;
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve({ timedOut: false, kind });
    }
  }
}

const teams = new Map(); // teamId → Team

function teamOf(teamId) {
  const id = String(teamId || 'default');
  let t = teams.get(id);
  if (!t) { t = new Team(id); teams.set(id, t); }
  return t;
}

function bytesOf(record) { return Buffer.byteLength(JSON.stringify(record), 'utf8'); }

/* ════════════════ ROSTER ═══════════════ */

/**
 * Provision a teammate (DSH spawnTeammate: append+flush the provisioning
 * member FIRST, then the spawn provider runs; provider failure → durable
 * failed member whose name is burned).
 */
export function spawnTeammate(teamId, name, { role = '', systemPrompt = '' } = {}) {
  const t = teamOf(teamId);
  const n = String(name || '').trim();
  if (!NAME_RE.test(n) || n.length > 64) {
    return { ok: false, code: 'TEAM_MEMBER_NAME_INVALID', error: 'name must be lowercase kebab-case, ≤64 chars' };
  }
  if (t.members.has(n) || [...t.members.values()].some((m) => m.burnedNames?.includes(n))) {
    return { ok: false, code: 'TEAM_MEMBER_NAME_TAKEN', error: 'names are never reusable' };
  }
  if (t.members.size >= TEAM_LIMITS.maxMembers) {
    return { ok: false, code: 'TEAM_MEMBER_LIMIT', error: `max ${TEAM_LIMITS.maxMembers} members (including failed)` };
  }
  const member = {
    name: n,
    role: String(role || '').slice(0, 200),
    systemPrompt: String(systemPrompt || '').slice(0, 4000),
    phase: 'provisioning',      // provisioning → active | failed
    status: 'idle',             // running | idle (active members)
    born: Date.now(),
  };
  t.members.set(n, member);
  t.leadLog.push({ type: 'team/member/provisioning', name: n, at: member.born });
  t.bump('roster');
  // JEXI spawn provider: the continuable subagent slot is created lazily on
  // first delivery (cold-resume on wakeup — DSH inactive semantics).
  member.phase = 'active';
  t.leadLog.push({ type: 'team/member/active', name: n, at: Date.now() });
  t.bump('roster');
  return { ok: true, member: memberShape(member) };
}

export function failTeammate(teamId, name, reason = 'provider failure') {
  const t = teamOf(teamId);
  const m = t.members.get(String(name || ''));
  if (!m) return { ok: false, code: 'TEAM_MEMBER_UNKNOWN' };
  m.phase = 'failed';
  m.error = String(reason).slice(0, 300);
  m.burnedNames = [...(m.burnedNames || []), m.name];
  t.leadLog.push({ type: 'team/member/failed', name: m.name, reason: m.error, at: Date.now() });
  t.bump('roster');
  return { ok: true, member: memberShape(m) };
}

export function setStatus(teamId, name, status) {
  const t = teamOf(teamId);
  const m = t.members.get(String(name || ''));
  if (!m) return { ok: false, code: 'TEAM_MEMBER_UNKNOWN' };
  if (!['running', 'idle'].includes(status)) return { ok: false, code: 'TEAM_STATUS_INVALID' };
  m.status = status;
  t.bump('status');
  return { ok: true };
}

export function listRoster(teamId) {
  const t = teamOf(teamId);
  return [...t.members.values()].map((m) => ({
    ...memberShape(m),
    live: m.phase === 'active' && m.status === 'running',
    inactive: m.phase !== 'active',
    pendingMail: (t.inbox.get(m.name) || []).filter((x) => x.state === 'queued').length,
  }));
}

function memberShape(m) {
  return { name: m.name, role: m.role, phase: m.phase, status: m.status, born: m.born, ...(m.error ? { error: m.error } : {}) };
}

/* ════════════════ DURABLE MAILBOX ═══════════════ */

/**
 * Send a peer message: validate membership → append team/message/queued →
 * (quiet) deliver to a live member's inbox; queued ≠ error, it means deferred.
 */
export function sendMessage(teamId, { from, to, text }) {
  const t = teamOf(teamId);
  const sender = String(from || 'lead');
  const target = String(to || '');
  if (sender !== 'lead' && !t.members.has(sender)) return { ok: false, code: 'TEAM_MEMBER_UNKNOWN', error: `sender ${sender} not on roster` };
  if (!t.members.has(target)) return { ok: false, code: 'TEAM_MEMBER_UNKNOWN', error: `target ${target} not on roster` };
  const body = String(text || '');
  const id = `msg-${crypto.randomUUID().slice(0, 12)}`;
  const record = { id, from: sender, to: target, text: body, state: 'queued', claimed: false, at: Date.now() };
  if (bytesOf(record) > TEAM_LIMITS.maxMessageBytes) {
    return { ok: false, code: 'TEAM_MESSAGE_TOO_LARGE', error: `framed message exceeds ${TEAM_LIMITS.maxMessageBytes} bytes` };
  }
  const pending = (t.inbox.get(target) || []).filter((x) => x.state === 'queued');
  if (pending.length >= TEAM_LIMITS.maxPendingMessagesPerMember) {
    return { ok: false, code: 'TEAM_MAILBOX_FULL', error: `per-target pending cap ${TEAM_LIMITS.maxPendingMessagesPerMember}` };
  }
  const queue = t.inbox.get(target) || [];
  queue.push(record);
  t.inbox.set(target, queue);
  t.leadLog.push({ type: 'team/message/queued', id, from: sender, to: target, at: record.at });
  // Quiet delivery: an ACTIVE teammate receives now; an inactive one stays
  // queued (DSH: quiet delivery never activates a cold member).
  const m = t.members.get(target);
  if (m && m.phase === 'active') {
    record.state = 'delivered';
    t.leadLog.push({ type: 'team/message/delivered', id, to: target, at: Date.now() });
  }
  t.bump('mailbox');
  return { ok: true, id, state: record.state, ...(record.state === 'queued' ? { note: 'queued — delivery deferred (target inactive); do not resend' } : {}) };
}

/** FIFO claim of the next unclaimed message for a member (model turn input). */
export function claimNextMessage(teamId, memberName) {
  const t = teamOf(teamId);
  const queue = t.inbox.get(String(memberName || '')) || [];
  const msg = queue.find((x) => !x.claimed);
  if (!msg) return null;
  msg.claimed = true;
  if (msg.state !== 'delivered') {
    msg.state = 'delivered';
    t.leadLog.push({ type: 'team/message/delivered', id: msg.id, to: memberName, at: Date.now() });
  }
  t.bump('mailbox');
  return { id: msg.id, from: msg.from, text: `Team message ${msg.id} from ${msg.from}:\n${msg.text}` };
}

export function readInbox(teamId, memberName) {
  const t = teamOf(teamId);
  return (t.inbox.get(String(memberName || '')) || []).map(({ id, from, state, at, text }) => ({ id, from, state, at, chars: text.length }));
}

/* ════════════════ SHARED TASK DAG ═══════════════ */

function taskShape(task) {
  if (task.deleted) return { id: task.id, deleted: true, revision: task.revision };
  const { deleted, ...rest } = task;
  return rest;
}

function blockersComplete(t, task) {
  return (task.dependsOn || []).every((depId) => {
    const dep = t.tasks.get(depId);
    return dep && !dep.deleted && dep.status === 'completed';
  });
}

function dagValid(t, taskId, dependsOn) {
  const deps = [...new Set(dependsOn || [])];
  if (deps.some((d) => d === taskId)) return 'self edge';
  for (const d of deps) {
    const dep = t.tasks.get(d);
    if (!dep) return `unknown dependency ${d}`;
    if (dep.deleted) return `deleted dependency ${d}`;
  }
  // cycle check over the post-mutation graph
  const graph = new Map();
  for (const [id, task] of t.tasks) graph.set(id, (task.dependsOn || []).filter(Boolean));
  if (t.tasks.has(taskId)) graph.set(taskId, deps);
  else graph.set(taskId, []);
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 1) return false;
    if (state.get(id) === 2) return true;
    state.set(id, 1);
    for (const next of graph.get(id) || []) if (!visit(next)) return false;
    state.set(id, 2);
    return true;
  };
  for (const id of graph.keys()) if (!visit(id)) return 'dependency cycle';
  return null;
}

export function createTask(teamId, { title, owner = null, dependsOn = [], scopes = [] } = {}) {
  const t = teamOf(teamId);
  const liveCount = [...t.tasks.values()].filter((x) => !x.deleted).length;
  if (liveCount >= TEAM_LIMITS.maxTasks) return { ok: false, code: 'TEAM_TASK_LIMIT' };
  const deps = [...new Set((dependsOn || []).map(String))];
  const id = `task-${t.nextTaskId}`;
  // DSH: numeric task-<n> ids require a safe-integer suffix; report LIMIT
  // instead of reusing the final safe id.
  if (!Number.isSafeInteger(t.nextTaskId)) return { ok: false, code: 'TEAM_TASK_LIMIT' };
  const cycle = dagValid(t, id, deps);
  if (cycle) return { ok: false, code: 'TEAM_TASK_DAG_INVALID', error: cycle };
  t.nextTaskId += 1;
  const task = {
    id, title: String(title || '').slice(0, 300), status: 'pending',
    owner: owner ? String(owner) : null, dependsOn: deps,
    writeScopes: (scopes || []).map((s) => String(s).replace(/^\/+/, '')).filter(Boolean),
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(),
  };
  t.tasks.set(id, task);
  t.bump('task');
  return { ok: true, task: taskShape(task), ready: blockersComplete(t, task) };
}

function mutateTask(teamId, taskId, { expectedRevision, mutate } = {}) {
  const t = teamOf(teamId);
  const task = t.tasks.get(String(taskId || ''));
  if (!task) return { ok: false, code: 'TEAM_TASK_UNKNOWN', error: `no task ${taskId}` };
  if (task.deleted) return { ok: false, code: 'TEAM_TASK_UNKNOWN', error: 'task is a tombstone' };
  if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== task.revision) {
    return { ok: false, code: 'TEAM_TASK_STALE_REVISION', error: `expected revision ${expectedRevision} but task is at ${task.revision} — re-read and retry` };
  }
  const out = mutate(task);
  if (out && out.error) return { ok: false, code: out.code || 'TEAM_TASK_INVALID', error: out.error };
  task.revision += 1;
  task.updatedAt = Date.now();
  t.bump('task');
  return { ok: true, task: taskShape(task), ready: blockersComplete(t, task) };
}

export function claimTask(teamId, taskId, memberName) {
  return mutateTask(teamId, taskId, {
    mutate: (task) => {
      if (task.status !== 'pending') return { error: `task is ${task.status}, only a ready pending task can be claimed` };
      if (!blockersComplete(teamOf(teamId), task)) return { error: 'not ready — blockers not complete' };
      task.status = 'in_progress';
      task.owner = String(memberName);
    },
  });
}

export function updateTask(teamId, taskId, patch = {}, opts = {}) {
  return mutateTask(teamId, taskId, {
    ...opts,
    mutate: (task) => {
      const who = String(patch.by || task.owner || 'lead');
      const isOwnerOrLead = who === task.owner || who === 'lead';
      if (!isOwnerOrLead) return { code: 'TEAM_TASK_FORBIDDEN', error: 'only the owner or the Lead can edit' };
      if (patch.title !== undefined) task.title = String(patch.title).slice(0, 300);
      if (patch.dependsOn !== undefined) {
        const deps = [...new Set(patch.dependsOn.map(String))];
        const cycle = dagValid(teamOf(teamId), task.id, deps);
        if (cycle) return { code: 'TEAM_TASK_DAG_INVALID', error: cycle };
        for (const d of deps) {
          if (d === task.id) return { code: 'TEAM_TASK_DAG_INVALID', error: 'self edge' };
          const dep = teamOf(teamId).tasks.get(d);
          if (!dep) return { code: 'TEAM_TASK_DAG_INVALID', error: `unknown dependency ${d}` };
          if (dep.deleted) return { code: 'TEAM_TASK_DAG_INVALID', error: `deleted dependency ${d}` };
        }
        task.dependsOn = deps;
      }
      if (patch.writeScopes !== undefined) task.writeScopes = patch.writeScopes.map((s) => String(s).replace(/^\/+/, '')).filter(Boolean);
      if (patch.status !== undefined && ['pending', 'in_progress', 'completed'].includes(patch.status)) task.status = patch.status;
      if (patch.release) { task.owner = null; if (task.status === 'in_progress') task.status = 'pending'; }
    },
  });
}

export function completeTask(teamId, taskId, opts = {}) {
  return mutateTask(teamId, taskId, {
    ...opts,
    mutate: (task) => {
      const who = String(opts.by || task.owner || 'lead');
      if (who !== task.owner && who !== 'lead') return { code: 'TEAM_TASK_FORBIDDEN', error: 'only the owner or the Lead can complete' };
      task.status = 'completed';
      task.completedAt = Date.now();
    },
  });
}

export function deleteTask(teamId, taskId, opts = {}) {
  const t = teamOf(teamId);
  const task = t.tasks.get(String(taskId || ''));
  if (!task) return { ok: false, code: 'TEAM_TASK_UNKNOWN' };
  if (task.deleted) return { ok: false, code: 'TEAM_TASK_UNKNOWN', error: 'already a tombstone' };
  for (const [, other] of t.tasks) {
    if (!other.deleted && (other.dependsOn || []).includes(task.id)) {
      return { ok: false, code: 'TEAM_TASK_DAG_INVALID', error: `non-deleted task ${other.id} depends on it` };
    }
  }
  if (opts.expectedRevision !== undefined && Number(opts.expectedRevision) !== task.revision) {
    return { ok: false, code: 'TEAM_TASK_STALE_REVISION', error: `expected revision ${opts.expectedRevision} but task is at ${task.revision}` };
  }
  task.deleted = true;
  task.revision += 1;
  task.tombstonedAt = Date.now();
  t.bump('task');
  return { ok: true };
}

export function listTasks(teamId, { includeDeleted = false, readyOnly = false } = {}) {
  const t = teamOf(teamId);
  return [...t.tasks.values()]
    .filter((task) => includeDeleted || !task.deleted)
    .filter((task) => !readyOnly || (task.status === 'pending' && blockersComplete(t, task)))
    .map((task) => ({ ...taskShape(task), ready: task.deleted ? undefined : blockersComplete(t, task) }));
}

/* ════════════════ waitForChange ═══════════════ */

/**
 * Wait for ONE roster/task/mailbox/status edge that occurs AFTER
 * registration (DSH: does not replay changes that already happened).
 * Bounds: 10 s … 1 h. Resolves { timedOut }.
 */
export function waitForChange(teamId, { sinceVersion = null, timeoutMs = 10000 } = {}) {
  const t = teamOf(teamId);
  const since = sinceVersion === null ? t.version : Number(sinceVersion);
  if (t.version > since) return Promise.resolve({ timedOut: false, kind: 'already' });
  const clamped = Math.min(Math.max(timeoutMs, 10000), 3600000);
  return new Promise((resolve) => {
    const w = {
      sinceVersion: since,
      resolve: (r) => resolve(r),
      timer: setTimeout(() => {
        t.waiters = t.waiters.filter((x) => x !== w);
        resolve({ timedOut: true });
      }, clamped),
    };
    t.waiters.push(w);
  });
}

/* Diagnostics: live team shapes (never message bodies). */
export function teamStatus(teamId) {
  const t = teamOf(teamId);
  return {
    id: t.id,
    version: t.version,
    members: t.members.size,
    tasks: { live: [...t.tasks.values()].filter((x) => !x.deleted).length, tombstones: [...t.tasks.values()].filter((x) => x.deleted).length },
    queuedMessages: [...t.inbox.values()].reduce((n, q) => n + q.filter((m) => m.state === 'queued').length, 0),
    leadLogRecords: t.leadLog.length,
  };
}

/** Test-only: hard-drop a team (mirrors DSH disposal). */
export function disposeTeam(teamId) {
  const t = teams.get(String(teamId || ''));
  if (!t) return false;
  for (const w of t.waiters) { clearTimeout(w.timer); w.resolve({ timedOut: true, disposed: true }); }
  teams.delete(t.id);
  return true;
}
