/**
 * B208 — AGENT MAIL: the structured communication protocol between JEXI and
 * her employees. No free-for-all chat: every message is typed, addressed,
 * task-scoped, and recorded. The UI translates these into the human-friendly
 * activity stream; internally they are the machine-readable contract.
 *
 * Message types (the protocol vocabulary):
 *   TASK_ASSIGNMENT  JEXI → employee: a structured work brief
 *   TASK_UPDATE      employee → JEXI: progress while working
 *   FINDING          employee → JEXI: an intermediate discovery
 *   ARTIFACT         employee → JEXI: a produced artifact (file/report/data)
 *   QUESTION         employee → JEXI: a blocking question
 *   RESULT           employee → JEXI: the completed deliverable
 *   CORRECTION       JEXI → employee: what was wrong; do it again with this
 *   REVIEW           employee (reviewer) → JEXI: review verdict of another's work
 *   VERIFICATION     employee (verifier) → JEXI: pass/fail against criteria
 *   HANDOFF          employee → employee (via JEXI): work transfer
 *   FAILURE          employee → JEXI: an execution failure report
 *   RECOVERY         JEXI → employee: a recovery instruction (retry/switch/replan)
 */

let __seq = 0;
const nextId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(++__seq).toString(36)}`;

export const MESSAGE_TYPES = [
  'TASK_ASSIGNMENT', 'TASK_UPDATE', 'FINDING', 'ARTIFACT', 'QUESTION',
  'RESULT', 'CORRECTION', 'REVIEW', 'VERIFICATION', 'HANDOFF', 'FAILURE', 'RECOVERY',
];

/** Create a protocol message. Extra fields pass through; the envelope is enforced. */
export function message({ from, to, taskId, type, content, artifacts, priority, status, parentId, ...rest }) {
  if (!MESSAGE_TYPES.includes(type)) throw new Error(`AgentMail: unknown message type "${type}"`);
  return {
    id: nextId('msg'),
    ts: new Date().toISOString(),
    from: String(from || 'jexi'),
    to: String(to || 'jexi'),
    taskId: taskId ? String(taskId) : null,
    type,
    content: String(content || '').slice(0, 20000),
    artifacts: Array.isArray(artifacts) ? artifacts.map(normalizeArtifact) : [],
    priority: ['low', 'normal', 'high'].includes(priority) ? priority : 'normal',
    status: ['draft', 'sent', 'delivered', 'read'].includes(status) ? status : 'sent',
    parentId: parentId ? String(parentId) : null,
    ...rest,
  };
}

/** Artifacts are first-class: typed, named, and content-carrying. */
export function normalizeArtifact(a) {
  if (!a || typeof a !== 'object') return { kind: 'text', name: 'artifact', content: String(a || '').slice(0, 4000) };
  return {
    kind: String(a.kind || 'text').slice(0, 24),        // text | file | code | report | data | url | test-result | log
    name: String(a.name || 'artifact').slice(0, 120),
    content: String(a.content || '').slice(0, 100000),   // the actual payload
    ...(a.url ? { url: String(a.url).slice(0, 500) } : {}),
    ...(a.meta && typeof a.meta === 'object' ? { meta: a.meta } : {}),
  };
}

/**
 * The per-task mailbox. JEXI is the hub: employees never message each other
 * directly (a HANDOFF is addressed through her). Everything is recorded in
 * order, so the full conversation of a task is replayable.
 */
export class TaskMailbox {
  constructor(taskId) {
    this.taskId = taskId;
    this.messages = [];
    this.listeners = new Set();
  }
  /** Post a message: records it and notifies listeners (JEXI's supervision). */
  post(msg) {
    this.messages.push(msg);
    if (this.messages.length > 500) this.messages.splice(0, this.messages.length - 500);
    for (const fn of this.listeners) { try { fn(msg); } catch { /* listeners never break mail */ } }
    return msg;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  byType(type) { return this.messages.filter((m) => m.type === type); }
  threadFor(subtaskId) { return this.messages.filter((m) => m.subtaskId === subtaskId); }
  lastFrom(agentId, type) {
    return [...this.messages].reverse().find((m) => m.from === agentId && (!type || m.type === type)) || null;
  }
}

/** Render a mail message as a human-friendly activity line (no raw model ids, no chain-of-thought). */
export function mailToActivityLine(msg, nameFor) {
  const name = (id) => (nameFor ? nameFor(id) : id);
  switch (msg.type) {
    case 'TASK_ASSIGNMENT': return `📋 Assignment received — ${msg.title || 'task'}`;
    case 'TASK_UPDATE': return `${String(msg.content || '').slice(0, 160)}`;
    case 'FINDING': return `🔎 ${String(msg.content || '').slice(0, 160)}`;
    case 'ARTIFACT': return `📦 ${String(msg.content || 'produced an artifact').slice(0, 160)}`;
    case 'RESULT': return `✅ Delivered: ${String(msg.title || msg.content || '').slice(0, 160)}`;
    case 'CORRECTION': return `↩ Correction requested — ${String(msg.content || '').slice(0, 140)}`;
    case 'VERIFICATION': return `${msg.verdict === 'pass' ? '✓' : '✗'} Verification ${msg.verdict || 'done'}`;
    case 'REVIEW': return `📝 Review: ${String(msg.verdict || msg.content || '').slice(0, 140)}`;
    case 'FAILURE': return `⚠ ${String(msg.content || 'failed').slice(0, 160)}`;
    case 'RECOVERY': return `🔄 ${String(msg.content || 'recovery').slice(0, 160)}`;
    case 'HANDOFF': return `↪ Handoff → ${name(msg.to)}`;
    default: return String(msg.content || msg.type).slice(0, 160);
  }
}
