/**
 * JEXI OS — Phase 16 Scope H — Display + Interaction Modes
 *
 * Pattern (researched at source level in @artooi/ag-ui-web-component@0.1.1):
 *  - Two ORTHOGONAL axes, independently switchable at runtime, no reload.
 *  - state_hook.ts: `read_<name>` always registered ungated; `set_<name>` gets
 *    `[X_DESTRUCTIVE_KEY]: true` stamped into its schema. Read vs write is a
 *    declared property of the tool, not a UI preference.
 *  - is_destructive.ts: gating keys off the DECLARED flag
 *    (`parameters['x-destructive'] === true`), with name shape as fallback.
 *  - ag_ui_chat.ts:319 `if (isDestructive(tool.parameters) && !this.autoConfirm)`
 *    — a single runtime-mutable property flips the whole axis. Decline settles
 *    the card to TOOL_CALL_STATUS.DECLINED: an explicit terminal state, never
 *    a silent drop.
 *  - conversation_store.ts: ClientConversationStore seam keyed by thread_id
 *    with namespaced prefixes, so two tabs hold independent conversations.
 *
 * Axes:
 *  displayMode:     inline | minimal | compact | full
 *    Controls tool-card verbosity, applied THROUGH Scope C rows: this module
 *    calls rows.render(event) to obtain the canonical content and returns a
 *    declarative rowOverride describing how much of it to show. It never
 *    mutates Scope C row code or previously issued rows.
 *  interactionMode: plan | act
 *    plan = read-only; write/edit/exec/bash tool events are REFUSED with
 *           E_PLAN_MODE_READONLY (named refusal, never silently dropped).
 *    act  = all events pass (Scope G approval gating still applies downstream).
 *
 * Contract:
 *  modes.setDisplayMode(sessionId, mode)     -> { mode }
 *  modes.setInteractionMode(sessionId, mode) -> { mode }
 *  modes.get(sessionId)                      -> { displayMode, interactionMode }
 *  modes.apply(turnId, event) -> {
 *    allowed: boolean,
 *    reason?: string,            // E_PLAN_MODE_READONLY when gated
 *    rowOverride?: object,       // declarative; caller applies it to the Scope C row
 *    sessionId, turnId, displayMode, interactionMode, classification
 *  }
 *
 * Rules:
 *  - Real state per session (Map keyed by sessionId), not a global singleton.
 *  - Unknown mode -> throws E_UNKNOWN_MODE.
 *  - Unknown sessionId on get() -> returns defaults, no throw.
 *  - apply() in plan mode: write/edit/exec/bash tool event
 *      -> { allowed: false, reason: 'E_PLAN_MODE_READONLY' }
 *  - apply() in act mode: all events pass.
 *  - Switching modes mid-turn does NOT retroactively change rows already
 *    rendered this turn; only future rows. apply() is pure w.r.t. the past:
 *    it emits a fresh override each call and never re-reads or rewrites a
 *    previously issued one. The per-turn ledger keeps frozen copies so the
 *    guarantee is inspectable, not merely asserted.
 *  - Deterministic for the same (session, mode, event): no clock, no counter
 *    and no randomness anywhere on the apply() path.
 *
 * Defaults: displayMode 'compact' (mirrors the library's collapsed-by-default
 * body with the argument head visible); interactionMode 'act', because
 * destructive-action safety is Scope G's job — defaulting to 'plan' would make
 * writes unavailable rather than gated.
 */

import { rows } from './rows/index.js';

export const DISPLAY_MODES = ['inline', 'minimal', 'compact', 'full'];
export const INTERACTION_MODES = ['plan', 'act'];

export const DEFAULT_DISPLAY_MODE = 'compact';
export const DEFAULT_INTERACTION_MODE = 'act';

/** Same shape as Scope A's SESSION_ID_RE — a session id is not freeform. */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Verbosity table. maxLines null = unlimited. maxChars null = unbounded.
 * `preview` is label + the first `maxLines` lines of the Scope C content.
 */
const DISPLAY_TABLE = {
  inline:  { showArgs: false, showBody: false, maxLines: 0,    maxChars: null, collapsed: true },
  minimal: { showArgs: true,  showBody: true,  maxLines: 1,    maxChars: 200,  collapsed: true },
  compact: { showArgs: true,  showBody: true,  maxLines: 3,    maxChars: 600,  collapsed: true },
  full:    { showArgs: true,  showBody: true,  maxLines: null, maxChars: null, collapsed: false },
};

/**
 * Write-class tool names: write / edit / exec / bash and friends.
 * Follows the library's own convention that `set_<name>` (state_hook.ts) is
 * the destructive half of a state hook.
 */
const WRITE_TOOL_RE = new RegExp(
  [
    '^(write|edit|patch|apply|insert|append|overwrite|replace|move|rename|delete|remove|unlink|truncate)',
    '^(exec|execute|run|bash|shell|sh|zsh|cmd|spawn|system|eval|process|kill|signal)',
    '^(set|put|post|create|make|mkdir|touch|chmod|chown|mv|cp|rm|rmdir|dd|sed|commit|push|deploy|install|uninstall|restart|reboot)',
    '_(file|files|dir|directory|content|text|line|lines|config|state|env|var|secret|permission|branch)$',
  ].join('|'),
  'i'
);

/** Explicit read-class names — checked first, so `read_file` never matches `edit`. */
const READ_TOOL_RE = new RegExp(
  [
    '^(read|get|list|search|grep|find|cat|head|tail|view|show|stat|ls|du|wc|diff|describe|inspect|fetch|load|count|check|validate|verify|explain|summarize)',
    '^read_',
  ].join('|'),
  'i'
);

/** Tool-bearing event types; everything else is prose and never gated. */
const TOOL_EVENT_TYPES = new Set([
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.failed',
]);

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    throw fail('E_INVALID_SESSION', `Invalid sessionId: ${JSON.stringify(sessionId)}`);
  }
}

function assertMode(mode, allowed, axis) {
  if (typeof mode !== 'string' || !allowed.includes(mode)) {
    throw fail('E_UNKNOWN_MODE', `Unknown ${axis} mode: ${JSON.stringify(mode)} (expected one of ${allowed.join(', ')})`);
  }
}

/* ------------------------------------------------------------------ *
 * Persistence seam — mirrors the library's ClientConversationStore:
 * namespaced keys, per-session isolation, injectable backing store.
 * The in-memory session map is a CACHE; the store is the source of truth,
 * which is what makes a restart survivable.
 * ------------------------------------------------------------------ */

const MODES_KEY_PREFIX = 'jexi.chat:modes:';

function createMemoryStore() {
  const data = new Map();
  return {
    load: (sessionId) => (data.has(MODES_KEY_PREFIX + sessionId) ? data.get(MODES_KEY_PREFIX + sessionId) : null),
    save: (sessionId, value) => { data.set(MODES_KEY_PREFIX + sessionId, value); },
    clear: (sessionId) => { data.delete(MODES_KEY_PREFIX + sessionId); },
    keys: () => [...data.keys()].filter((k) => k.startsWith(MODES_KEY_PREFIX)).map((k) => k.slice(MODES_KEY_PREFIX.length)),
  };
}

function createSessionStorageStore() {
  const ss = globalThis.sessionStorage;
  return {
    load: (sessionId) => {
      const raw = ss.getItem(MODES_KEY_PREFIX + sessionId);
      if (raw === null) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    save: (sessionId, value) => { ss.setItem(MODES_KEY_PREFIX + sessionId, JSON.stringify(value)); },
    clear: (sessionId) => { ss.removeItem(MODES_KEY_PREFIX + sessionId); },
    keys: () => {
      const out = [];
      for (let i = 0; i < ss.length; i += 1) {
        const k = ss.key(i);
        if (k && k.startsWith(MODES_KEY_PREFIX)) out.push(k.slice(MODES_KEY_PREFIX.length));
      }
      return out;
    },
  };
}

/** Browser -> sessionStorage (survives reload); Node -> memory store. */
function defaultStore() {
  return typeof globalThis.sessionStorage !== 'undefined' && globalThis.sessionStorage
    ? createSessionStorageStore()
    : createMemoryStore();
}

let store = defaultStore();

/** Live per-session cache. Rehydrated from `store` on miss. */
const sessionCache = new Map(); // sessionId -> { displayMode, interactionMode }

/** Per-turn ledger of issued overrides, frozen at issue time. */
const turnLedger = new Map(); // turnId -> { turnId, sessionId, rows: [frozen override] }

/** Audit trail of mode switches (taxonomy has no mode.* event type, and
 *  adding one would mean editing Scope A — so it is kept locally). */
const switchHistory = [];

function defaults() {
  return { displayMode: DEFAULT_DISPLAY_MODE, interactionMode: DEFAULT_INTERACTION_MODE };
}

/** Coerce a stored value back into valid modes; corrupt storage -> defaults. */
function sanitize(raw) {
  const base = defaults();
  if (!raw || typeof raw !== 'object') return base;
  if (DISPLAY_MODES.includes(raw.displayMode)) base.displayMode = raw.displayMode;
  if (INTERACTION_MODES.includes(raw.interactionMode)) base.interactionMode = raw.interactionMode;
  return base;
}

/** Read-through: cache -> store -> defaults. Never throws for unknown session. */
function readSession(sessionId) {
  const cached = sessionCache.get(sessionId);
  if (cached) return { ...cached };
  const stored = store.load(sessionId);
  const value = sanitize(stored);
  sessionCache.set(sessionId, value);
  return { ...value };
}

function writeSession(sessionId, value) {
  const next = sanitize(value);
  sessionCache.set(sessionId, next);
  store.save(sessionId, next);
  return { ...next };
}

/* ------------------------------------------------------------------ *
 * Tool classification — declared flag wins, name shape is the fallback.
 * ------------------------------------------------------------------ */

function toolNameOf(event) {
  const p = (event && event.payload) || {};
  if (typeof p.toolName === 'string' && p.toolName) return p.toolName;
  if (typeof p.name === 'string' && p.name) return p.name;
  if (typeof p.tool === 'string' && p.tool) return p.tool;
  return '';
}

/**
 * @returns {'write'|'read'|'unclassified'}
 * Declaration (`payload.destructive` / `payload['x-destructive']`) takes
 * precedence exactly as is_destructive.ts does; only undeclared tools fall
 * back to name shape.
 */
export function classifyTool(event) {
  const p = (event && event.payload) || {};
  const declared = p.destructive !== undefined ? p.destructive : p['x-destructive'];
  if (declared === true) return 'write';
  if (declared === false) return 'read';

  const name = toolNameOf(event);
  if (!name) return 'unclassified';
  if (READ_TOOL_RE.test(name)) return 'read';
  if (WRITE_TOOL_RE.test(name)) return 'write';
  return 'unclassified';
}

/* ------------------------------------------------------------------ *
 * Scope C content + label, then the verbosity projection.
 * ------------------------------------------------------------------ */

function scopeCContent(event) {
  try {
    const rendered = rows.render(event);
    return typeof rendered.content === 'string' ? rendered.content : '';
  } catch {
    return '';
  }
}

function labelFor(event) {
  const name = toolNameOf(event);
  if (name) return name;
  return (event && typeof event.type === 'string') ? event.type : 'row';
}

function clamp(text, maxChars) {
  if (maxChars === null || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

/** Pure projection of Scope C content onto a verbosity level. */
function projectVerbosity(displayMode, event) {
  const spec = DISPLAY_TABLE[displayMode];
  const label = labelFor(event);
  const content = scopeCContent(event);
  const lines = content === '' ? [] : content.split('\n');

  if (!spec.showBody || spec.maxLines === 0 || lines.length === 0) {
    return {
      verbosity: displayMode,
      label,
      showArgs: spec.showArgs,
      showBody: spec.showBody,
      maxLines: spec.maxLines,
      maxChars: spec.maxChars,
      collapsed: spec.collapsed,
      lineCount: 0,
      truncatedLines: lines.length,
      preview: label,
    };
  }

  const limit = spec.maxLines === null ? lines.length : Math.min(spec.maxLines, lines.length);
  const shown = lines.slice(0, limit);
  const body = clamp(shown.join('\n'), spec.maxChars);

  return {
    verbosity: displayMode,
    label,
    showArgs: spec.showArgs,
    showBody: true,
    maxLines: spec.maxLines,
    maxChars: spec.maxChars,
    collapsed: spec.collapsed,
    lineCount: shown.length,
    truncatedLines: lines.length,
    preview: `${label}\n${body}`,
  };
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export function get(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    // Unknown / malformed session on read: defaults, no throw (spec).
    return defaults();
  }
  return readSession(sessionId);
}

export function setDisplayMode(sessionId, mode) {
  assertSessionId(sessionId);
  assertMode(mode, DISPLAY_MODES, 'display');
  const current = readSession(sessionId);
  const next = writeSession(sessionId, { ...current, displayMode: mode });
  switchHistory.push({ sessionId, axis: 'displayMode', from: current.displayMode, to: mode });
  return { mode: next.displayMode };
}

export function setInteractionMode(sessionId, mode) {
  assertSessionId(sessionId);
  assertMode(mode, INTERACTION_MODES, 'interaction');
  const current = readSession(sessionId);
  const next = writeSession(sessionId, { ...current, interactionMode: mode });
  switchHistory.push({ sessionId, axis: 'interactionMode', from: current.interactionMode, to: mode });
  return { mode: next.interactionMode };
}

export function apply(turnId, event) {
  if (typeof turnId !== 'string' || !turnId) {
    throw fail('E_UNKNOWN_TURN', 'turnId is required');
  }
  if (!event || typeof event.type !== 'string') {
    throw fail('E_UNMAPPED_EVENT', 'event.type missing or not string');
  }

  const sessionId = typeof event.sessionId === 'string' && SESSION_ID_RE.test(event.sessionId)
    ? event.sessionId
    : 'default-session';

  // Current modes at the moment of this call. Rows already issued this turn
  // are not revisited, so a mid-turn switch affects only future rows.
  const { displayMode, interactionMode } = readSession(sessionId);

  const isToolEvent = TOOL_EVENT_TYPES.has(event.type);
  const classification = isToolEvent ? classifyTool(event) : 'n/a';

  // plan mode: write-class tool events are REFUSED with a named error.
  if (interactionMode === 'plan' && isToolEvent && classification === 'write') {
    const refusal = {
      allowed: false,
      reason: 'E_PLAN_MODE_READONLY',
      rowOverride: freeze(projectVerbosity(displayMode, event)),
      sessionId,
      turnId,
      displayMode,
      interactionMode,
      classification,
    };
    record(turnId, sessionId, refusal);
    return refusal;
  }

  const result = {
    allowed: true,
    rowOverride: freeze(projectVerbosity(displayMode, event)),
    sessionId,
    turnId,
    displayMode,
    interactionMode,
    classification,
  };
  record(turnId, sessionId, result);
  return result;
}

function freeze(obj) {
  return Object.freeze({ ...obj });
}

function record(turnId, sessionId, result) {
  let entry = turnLedger.get(turnId);
  if (!entry) {
    entry = { turnId, sessionId, rows: [] };
    turnLedger.set(turnId, entry);
  }
  // Frozen snapshot at issue time — later switches cannot reach back and alter
  // it. The override is stored verbatim (not spread into the wrapper) so a
  // caller can byte-compare a ledger entry against the apply() that produced it.
  entry.rows.push(freeze({
    rowOverride: { ...result.rowOverride },
    allowed: result.allowed,
    reason: result.reason ?? null,
  }));
}

/* ------------------------------------------------------------------ *
 * Inspection + probe seams
 * ------------------------------------------------------------------ */

/** Frozen rows already issued for a turn (proof of non-retroactivity). */
export function turn(turnId) {
  const entry = turnLedger.get(turnId);
  if (!entry) return { turnId, sessionId: null, rows: [] };
  return { turnId: entry.turnId, sessionId: entry.sessionId, rows: entry.rows.map((r) => ({ ...r })) };
}

export function sessions() {
  return store.keys().map((sessionId) => ({ sessionId, ...readSession(sessionId) }));
}

export function history() {
  return switchHistory.map((h) => ({ ...h }));
}

export function listDisplayModes() {
  return [...DISPLAY_MODES];
}

export function listInteractionModes() {
  return [...INTERACTION_MODES];
}

/** Inject a backing store (e.g. a server-backed one). Cache is dropped. */
export function _useStore(nextStore) {
  store = nextStore || defaultStore();
  sessionCache.clear();
}

/**
 * Simulated restart: drop the in-memory cache only. The store survives, so
 * the next get()/apply() rehydrates from it — real persistence, not a claim.
 */
export function _simulateRestart() {
  sessionCache.clear();
}

export function _reset() {
  sessionCache.clear();
  turnLedger.clear();
  switchHistory.length = 0;
  store = defaultStore();
  // Wipe any persisted modes so probes start from a known state.
  for (const sessionId of store.keys()) store.clear(sessionId);
}

export const modes = {
  get,
  setDisplayMode,
  setInteractionMode,
  apply,
  classifyTool,
  turn,
  sessions,
  history,
  listDisplayModes,
  listInteractionModes,
  _useStore,
  _simulateRestart,
  _reset,
};

export default modes;
