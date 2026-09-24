/**
 * JEXI OS — Phase 16 Scope K — Tool-Call Cards
 *
 * Scope C rows gave one-line representations; Scope F disclosure gave
 * three-layer wrapping. Neither gives the user a CARD for a tool invocation:
 * real argument rendering, real output rendering, status transitions, and
 * inline artifacts. Cards are the visual unit of a tool call.
 *
 * Researched at source level:
 *  - Agent Elements (agent-elements.21st.dev, 21st.dev Agent SDK). Tool cards
 *    are BashTool / EditTool / SearchTool / TodoTool / PlanTool / SubagentTool
 *    / McpTool / QuestionTool / GenericTool, plus ThinkingTool for streaming.
 *    Their shared vocabulary is the AI SDK tool-part state — `input-streaming`
 *    -> `output-available` — with a separate `ToolApproval` prop
 *    ({ approveLabel, rejectLabel, onApprove, onReject }) attached to the
 *    bash/edit cards rather than a status of its own. GenericTool takes only
 *    (step, state, onComplete): no specialised payload, which is exactly the
 *    fallback shape. McpTool carries McpToolInfo { serverName, toolName,
 *    displayName, category } — a namespaced tool identity. BashTool derives
 *    its header from the command itself
 *    (cmd.split('|').map(s => s.trim().split(/\s+/)[0]).slice(0,4).join(', ')),
 *    i.e. the pipeline's leading commands, not the raw argument blob.
 *    SearchTool takes a typed `results: SearchResult[]` array — results as
 *    structured entries, never inline prose.
 *  - Qredence/fleet-prime-agent, web/app/src/components/tools/approval-card.
 *    ApprovalCardStatus is a forward-only ladder — "pending" | "submitting"
 *    | "approved" | "rejected" | "changes-requested" | "answered" — and the
 *    status drives three separate pure mappings: getStatusLabel,
 *    getStatusClass and getStatusBadgeClass. Status -> badge is its own
 *    concern, which is what header.badge is here.
 *
 * Contract:
 *  toolcards.build(envelope, opts) -> {
 *    cardId, cardType, status,
 *    header: { label, args, badge },
 *    body:   { verbosity, content, artifacts: [] },
 *    footer?: { durationMs, tokensUsed, error, unclassified? },
 *    tool, startedAt, endedAt?
 *  }
 *  toolcards.update(cardId, patch) -> updated card
 *  toolcards.status(cardId) -> { cardType, status, startedAt, endedAt? }
 *
 * Rules implemented:
 *  - Card type is chosen by TOOL NAME, never by event content. Unknown name ->
 *    'generic' plus footer.unclassified = true.
 *  - Status moves forward only, along exactly the documented chain
 *    pending -> running -> ok | failed | refused. Any other edge, including
 *    skipping a level (pending -> ok), throws E_INVALID_TRANSITION.
 *  - Built from a Scope I routed envelope, never a raw Scope A event: a bare
 *    event is rejected with E_NOT_ROUTED. The Scope H verdict travels in the
 *    envelope, so the card never re-derives gating.
 *  - Args visibility defers to Scope H's rowOverride.showArgs, which is the
 *    "Scope H rowOverride semantics" the spec names: hidden at inline, shown
 *    at minimal / compact / full.
 *  - Body follows the Scope H verbosity ladder via rowOverride.maxLines and
 *    rowOverride.maxChars.
 *  - Artifacts are metadata only — { path, kind, size, hash }. Content is
 *    never inlined; Scope L owns the artifact panel.
 *  - Refused cards carry status 'refused' and the named Scope H reason.
 *  - Deterministic: no clock and no randomness anywhere. durationMs is derived
 *    from the events' own timestamps, not Date.now().
 */

export const CARD_TYPES = ['bash', 'edit', 'search', 'todo', 'plan', 'subagent', 'mcp', 'thinking', 'question', 'artifact', 'generic'];
export const STATUSES = ['pending', 'running', 'ok', 'failed', 'refused'];

/** Exactly the documented chain. No level skipping, no going back. */
const TRANSITIONS = {
  pending: ['running'],
  running: ['ok', 'failed', 'refused'],
  ok: [],
  failed: [],
  refused: [],
};

const TERMINAL = new Set(['ok', 'failed', 'refused']);

/** A card is the visual unit of a TOOL CALL — nothing else gets one. */
const TOOL_EVENT_TYPES = new Set(['tool.started', 'tool.progress', 'tool.completed', 'tool.failed']);

/**
 * Ordered name rules. Order matters: `task_list` must hit todo before the
 * subagent rule's bare `task` prefix, and the MCP namespace marker wins over
 * everything because `mcp_files__write` is an MCP call whatever it does.
 */
const CARD_RULES = [
  ['mcp', /^(mcp[._-]|.+__.+)/i],
  ['bash', /^(bash|sh|zsh|shell|terminal|command|run_command|exec_command|exec|execute|run|system|spawn|eval|process)/i],
  ['edit', /^(write|edit|patch|apply_patch|str_replace|insert|append|overwrite|create_file|delete|remove|move|rename|multiedit)/i],
  ['search', /^(read|grep|search|find|glob|list|ls|cat|view|head|tail|stat|scan|lookup)/i],
  ['todo', /^(todo|task_list|add_todo|update_todo|checklist)/i],
  ['plan', /^(plan|update_plan|create_plan|exit_plan_mode|propose_plan)/i],
  ['thinking', /^(think|thinking|reason|scratchpad|reflect)/i],
  ['question', /^(ask|question|ask_question|ask_user|request_input|clarify|elicit)/i],
  ['artifact', /^(artifact|create_artifact|save_artifact|export_artifact|publish_artifact)/i],
  ['subagent', /^(task|subagent|spawn_agent|dispatch_agent|agent_run|delegate)/i],
];

/** Badge styling keyed off the jcx theme tokens Scope C already inlines. */
const BADGES = {
  pending: { text: 'pending', tone: 'neutral', color: '#7a7163' }, // --jcx-ink-3
  running: { text: 'running', tone: 'accent', color: '#ffb88c' },  // --jcx-peach
  ok:      { text: 'ok',      tone: 'up',     color: '#4cc38a' },  // --jcx-up
  failed:  { text: 'failed',  tone: 'down',   color: '#ff5d5d' },  // --jcx-down
  refused: { text: 'refused', tone: 'warn',   color: '#e5b567' },  // --jcx-gold
};

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

/* ------------------------------------------------------------------ *
 * Deterministic hashing / sizing — no node:crypto, browser safe.
 * FNV-1a run twice from different offsets gives a 64-bit fingerprint.
 * This is a content fingerprint for change detection, NOT a security hash.
 * ------------------------------------------------------------------ */

function fnv1a(str, offset) {
  let h = offset >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function fingerprint(str) {
  const a = fnv1a(str, 0x811c9dc5).toString(16).padStart(8, '0');
  const b = fnv1a(str, 0x01000193).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

function byteLength(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
  let n = 0;
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else n += 3;
  }
  return n;
}

/* ------------------------------------------------------------------ *
 * Envelope guards
 * ------------------------------------------------------------------ */

function assertRoutedEnvelope(x) {
  if (!x || typeof x !== 'object') {
    throw fail('E_NOT_ROUTED', 'a routed envelope is required');
  }
  const looksRouted = Number.isInteger(x.seq) && Array.isArray(x.surfaces) && x.event && typeof x.event === 'object';
  if (!looksRouted) {
    const looksRaw = typeof x.type === 'string' && x.payload && typeof x.payload === 'object';
    throw fail(
      'E_NOT_ROUTED',
      looksRaw
        ? 'raw Scope A event supplied; tool cards are built from Scope I routed envelopes'
        : 'object is not a Scope I routed envelope (needs seq, surfaces, event)'
    );
  }
  return x;
}

/* ------------------------------------------------------------------ *
 * Card type by tool NAME
 * ------------------------------------------------------------------ */

export function cardTypeFor(toolName) {
  if (typeof toolName !== 'string' || toolName.length === 0) return 'generic';
  for (const [type, re] of CARD_RULES) {
    if (re.test(toolName)) return type;
  }
  return 'generic';
}

/* ------------------------------------------------------------------ *
 * Header / body rendering
 * ------------------------------------------------------------------ */

/** BashTool-style header: the pipeline's leading commands, not the arg blob. */
function bashLabel(args) {
  const cmd = typeof args.command === 'string' ? args.command
    : typeof args.cmd === 'string' ? args.cmd
      : typeof args.script === 'string' ? args.script
        : null;
  if (!cmd) return null;
  const heads = cmd.split('|').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).slice(0, 4);
  return heads.length ? heads.join(', ') : cmd.slice(0, 60);
}

function pathOf(args) {
  for (const k of ['path', 'file', 'filename', 'filePath', 'target']) {
    if (typeof args[k] === 'string' && args[k]) return args[k];
  }
  return null;
}

function labelFor(cardType, toolName, args) {
  if (cardType === 'bash') return bashLabel(args) || toolName;
  if (cardType === 'edit' || cardType === 'artifact') return pathOf(args) || toolName;
  if (cardType === 'search') return pathOf(args) || (typeof args.pattern === 'string' ? args.pattern : null) || toolName;
  if (cardType === 'mcp') {
    const parts = toolName.split('__');
    return parts.length > 1 ? `${parts[0]} / ${parts.slice(1).join('__')}` : toolName;
  }
  if (cardType === 'plan' && typeof args.title === 'string') return args.title;
  if (cardType === 'question' && typeof args.question === 'string') return args.question;
  return toolName;
}

function argsString(args) {
  if (!args || typeof args !== 'object') return '';
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

function resultString(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.result === 'string') return payload.result;
  if (payload.result !== undefined) {
    try { return JSON.stringify(payload.result); } catch { return String(payload.result); }
  }
  if (typeof payload.output === 'string') return payload.output;
  if (typeof payload.content === 'string') return payload.content;
  if (typeof payload.error === 'string') return payload.error;
  return '';
}

function applyVerbosity(text, rowOverride) {
  if (typeof text !== 'string' || text === '') return '';
  const maxLines = rowOverride && rowOverride.maxLines !== undefined ? rowOverride.maxLines : null;
  const maxChars = rowOverride && rowOverride.maxChars !== undefined ? rowOverride.maxChars : null;
  if (maxLines === 0) return '';
  const lines = text.split('\n');
  const kept = maxLines === null ? lines : lines.slice(0, maxLines);
  let out = kept.join('\n');
  if (maxChars !== null && out.length > maxChars) out = `${out.slice(0, maxChars)}…`;
  return out;
}

/* ------------------------------------------------------------------ *
 * Artifact extraction — metadata only, never inline content.
 * ------------------------------------------------------------------ */

const DIFF_RE = /(^|\n)(@@[^\n]*\n|---\s|\+\+\+\s)/;

function isDiff(text) {
  return typeof text === 'string' && DIFF_RE.test(text);
}

/**
 * @returns {Array<{path:string,kind:string,size:number,hash:string}>}
 * Content is measured and fingerprinted, then dropped.
 */
function extractArtifacts(cardType, args, resultText) {
  const out = [];
  const seen = new Set();

  const push = (path, kind, content) => {
    if (typeof path !== 'string' || !path) return;
    const key = `${path}\u0000${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    const body = typeof content === 'string' ? content : '';
    out.push({ path, kind, size: byteLength(body), hash: fingerprint(body) });
  };

  const path = pathOf(args);
  const patch = typeof args.patch === 'string' ? args.patch : null;
  const content = typeof args.content === 'string' ? args.content : null;

  if (cardType === 'edit') {
    if (patch) push(path || '(unknown)', 'patch', patch);
    if (content) push(path || '(unknown)', 'file', content);
    if (!patch && !content && path) push(path, 'file', resultText || '');
  } else if (cardType === 'artifact') {
    push(path || (typeof args.artifactId === 'string' ? args.artifactId : '(unknown)'), 'artifact', content || resultText || '');
  }

  // Any tool whose OUTPUT is a diff produced a diff artifact.
  if (isDiff(resultText)) {
    push(path || `${(args && args.toolName) || 'tool'}.diff`, 'diff', resultText);
  }

  return out;
}

/**
 * Terminal body source. An edit card shows the patch/diff it produced, not the
 * transport ack; anything else shows the tool's own output, falling back to
 * the arguments when the tool returned nothing renderable.
 */
function pickBodySource(rec, resultText) {
  if (rec.cardType === 'edit' && rec.args && typeof rec.args.patch === 'string' && rec.args.patch) {
    return rec.args.patch;
  }
  if (isDiff(resultText)) return resultText;
  if (resultText) return resultText;
  return rec.argsText;
}

/* ------------------------------------------------------------------ *
 * Card store
 * ------------------------------------------------------------------ */

const cards = new Map(); // cardId -> record

function tsOf(envelope) {
  const ts = envelope && envelope.event ? envelope.event.ts : undefined;
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function durationMs(card) {
  if (card.startedAt === null || card.endedAt === null) return null;
  return card.endedAt - card.startedAt;
}

function toCard(rec) {
  const card = {
    cardId: rec.cardId,
    cardType: rec.cardType,
    status: rec.status,
    header: {
      label: rec.label,
      args: rec.argsVisible ? rec.argsText : null,
      badge: { ...BADGES[rec.status] },
    },
    body: {
      verbosity: rec.verbosity,
      content: rec.bodyText,
      artifacts: rec.artifacts.map((a) => ({ ...a })),
    },
    tool: {
      name: rec.toolName,
      toolCallId: rec.toolCallId,
      sessionId: rec.sessionId,
      turnId: rec.turnId,
      seq: rec.seq,
    },
    startedAt: rec.startedAt,
  };
  if (rec.endedAt !== null) card.endedAt = rec.endedAt;

  const footer = {
    durationMs: durationMs(rec),
    tokensUsed: rec.tokensUsed,
    error: rec.error,
  };
  if (rec.unclassified) footer.unclassified = true;
  card.footer = footer;
  return card;
}

function transition(rec, next) {
  if (!STATUSES.includes(next)) throw fail('E_UNKNOWN_STATUS', `Unknown status: ${JSON.stringify(next)}`);
  if (next === rec.status) return rec; // idempotent re-assert of the same state
  const allowed = TRANSITIONS[rec.status];
  if (!allowed.includes(next)) {
    throw fail('E_INVALID_TRANSITION', `Cannot transition ${rec.status} -> ${next} (allowed: ${allowed.join(', ') || 'none, card is terminal'})`);
  }
  rec.status = next;
  return rec;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export function build(envelope, opts = {}) {
  assertRoutedEnvelope(envelope);
  const o = opts && typeof opts === 'object' ? opts : {};

  const event = envelope.event;
  const type = typeof event.type === 'string' ? event.type : '';
  if (!TOOL_EVENT_TYPES.has(type)) {
    // No silent fallback: a message.delta is not a tool call and must not mint
    // a 'generic' card just because it happened to be routed.
    throw fail('E_NOT_TOOL_EVENT', `tool cards are built from tool.* events, got: ${type}`);
  }
  const payload = (event.payload && typeof event.payload === 'object') ? event.payload : {};
  const toolName = typeof payload.toolName === 'string' && payload.toolName
    ? payload.toolName
    : (typeof payload.name === 'string' ? payload.name : '');
  const toolCallId = typeof payload.toolCallId === 'string' && payload.toolCallId
    ? payload.toolCallId
    : `seq-${envelope.seq}`;
  const cardId = typeof o.cardId === 'string' && o.cardId ? o.cardId : `card:${toolCallId}`;

  const rowOverride = (envelope.modes && envelope.modes.rowOverride) || o.rowOverride || null;
  const displayMode = (envelope.modes && envelope.modes.displayMode) || (rowOverride && rowOverride.verbosity) || 'compact';
  const refused = envelope.refused === true || (envelope.modes && envelope.modes.allowed === false);
  const refusalReason = (envelope.modes && envelope.modes.reason) || envelope.reason || null;

  // A terminal tool event must match an already-open card.
  if (type === 'tool.completed' || type === 'tool.failed') {
    const open = cards.get(cardId);
    if (!open) {
      throw fail('E_NO_OPEN_CARD', `${type} arrived for ${cardId} with no open card (no tool.started was routed)`);
    }
    return closeCard(open, envelope, o);
  }

  // Only tool.started / tool.progress reach here; completed and failed were
  // handled above.
  if (cards.has(cardId)) {
    const existing = cards.get(cardId);
    if (type === 'tool.started') {
      // A second open would otherwise fall through to the terminal branch and
      // fabricate an 'ok'. Refuse it by name instead.
      throw fail('E_CARD_ALREADY_OPEN', `tool.started arrived twice for ${cardId}; card is already ${existing.status}`);
    }
    if (TERMINAL.has(existing.status)) {
      // A closed card is immutable — progress must not rewrite it.
      throw fail('E_INVALID_TRANSITION', `card ${cardId} is terminal (${existing.status}); refusing a further ${type}`);
    }
    return closeCard(existing, envelope, o, { keepOpen: true });
  }

  const cardType = cardTypeFor(toolName);
  const args = (payload.args && typeof payload.args === 'object') ? payload.args : {};
  const argsText = argsString(args);

  const rec = {
    cardId,
    cardType,
    status: 'pending',
    toolName,
    toolCallId,
    sessionId: typeof event.sessionId === 'string' ? event.sessionId : null,
    turnId: typeof envelope.turnId === 'string' ? envelope.turnId : null,
    seq: envelope.seq,
    label: labelFor(cardType, toolName, args),
    args,          // stashed: tool.completed carries no args
    argsText,
    // Scope H owns arg visibility; the card does not second-guess it.
    argsVisible: rowOverride ? rowOverride.showArgs === true : displayMode !== 'inline',
    verbosity: displayMode,
    bodyText: '',
    artifacts: [],
    tokensUsed: typeof payload.tokensUsed === 'number' ? payload.tokensUsed : null,
    error: null,
    unclassified: cardType === 'generic',
    startedAt: tsOf(envelope),
    endedAt: null,
  };

  cards.set(cardId, rec);

  // A card opens on tool.started: pending -> running.
  if (type === 'tool.started') transition(rec, 'running');

  // Body renders the arguments while the tool is still in flight.
  rec.bodyText = applyVerbosity(argsText, rowOverride);

  if (refused) {
    // running -> refused, carrying the named Scope H reason. No fake ok.
    transition(rec, 'refused');
    rec.error = refusalReason || 'E_PLAN_MODE_READONLY';
    rec.endedAt = tsOf(envelope);
  }

  return toCard(rec);
}

function closeCard(rec, envelope, opts, extra = {}) {
  const event = envelope.event;
  const type = typeof event.type === 'string' ? event.type : '';
  const payload = (event.payload && typeof event.payload === 'object') ? event.payload : {};
  const rowOverride = (envelope.modes && envelope.modes.rowOverride) || opts.rowOverride || null;
  const refused = envelope.refused === true || (envelope.modes && envelope.modes.allowed === false);
  const refusalReason = (envelope.modes && envelope.modes.reason) || envelope.reason || null;

  const resultText = resultString(payload);
  // tool.completed/failed carry no args; fall back to what tool.started stashed.
  const payloadArgs = (payload.args && typeof payload.args === 'object') ? payload.args : {};
  const args = Object.keys(payloadArgs).length ? payloadArgs : (rec.args || {});

  if (type === 'tool.progress') {
    // Progress refreshes the body but never closes the card. A progress event
    // carries its text in payload.message (the same field Scope C's tool-use
    // row falls back to), so honour it before the stashed args.
    const progressText = resultText
      || (typeof payload.message === 'string' && payload.message ? payload.message : '');
    rec.bodyText = applyVerbosity(progressText || rec.argsText, rowOverride);
    if (typeof payload.tokensUsed === 'number') rec.tokensUsed = payload.tokensUsed;
    return toCard(rec);
  }

  if (typeof payload.tokensUsed === 'number') rec.tokensUsed = payload.tokensUsed;
  rec.endedAt = tsOf(envelope);
  rec.artifacts = extractArtifacts(rec.cardType, args, resultText);

  if (refused) {
    transition(rec, 'refused');
    rec.error = refusalReason || 'E_PLAN_MODE_READONLY';
  } else if (type === 'tool.failed') {
    transition(rec, 'failed');
    rec.error = typeof payload.error === 'string' ? payload.error
      : (payload.error && typeof payload.error.message === 'string' ? payload.error.message : 'E_TOOL_FAILED');
  } else {
    transition(rec, 'ok');
  }

  // Terminal body, projected through Scope H's ladder.
  rec.bodyText = applyVerbosity(pickBodySource(rec, resultText), rowOverride);
  void extra;
  return toCard(rec);
}

export function update(cardId, patch = {}) {
  const rec = cards.get(cardId);
  if (!rec) throw fail('E_UNKNOWN_CARD', `Unknown cardId: ${cardId}`);
  const p = patch && typeof patch === 'object' ? patch : {};

  if (p.result !== undefined) {
    const text = typeof p.result === 'string' ? p.result : (() => { try { return JSON.stringify(p.result); } catch { return String(p.result); } })();
    rec.artifacts = extractArtifacts(rec.cardType, {}, text);
    rec.bodyText = applyVerbosity(text, { maxLines: null, maxChars: null });
  }
  if (typeof p.error === 'string') rec.error = p.error;
  if (typeof p.tokensUsed === 'number') rec.tokensUsed = p.tokensUsed;
  if (p.endedAt !== undefined) rec.endedAt = typeof p.endedAt === 'number' ? p.endedAt : null;
  if (p.status !== undefined) transition(rec, p.status);

  return toCard(rec);
}

export function status(cardId) {
  const rec = cards.get(cardId);
  if (!rec) throw fail('E_UNKNOWN_CARD', `Unknown cardId: ${cardId}`);
  const out = { cardId: rec.cardId, cardType: rec.cardType, status: rec.status, startedAt: rec.startedAt };
  if (rec.endedAt !== null) out.endedAt = rec.endedAt;
  out.durationMs = durationMs(rec);
  return out;
}

/* ------------------------------------------------------------------ *
 * Inspection + probe seams
 * ------------------------------------------------------------------ */

export function get(cardId) {
  const rec = cards.get(cardId);
  if (!rec) throw fail('E_UNKNOWN_CARD', `Unknown cardId: ${cardId}`);
  return toCard(rec);
}

export function list() {
  return [...cards.values()].map((rec) => ({ cardId: rec.cardId, cardType: rec.cardType, status: rec.status, tool: rec.toolName }));
}

export function openCount() {
  return [...cards.values()].filter((rec) => !TERMINAL.has(rec.status)).length;
}

export function isToolEvent(envelope) {
  return !!(envelope && envelope.event && TOOL_EVENT_TYPES.has(envelope.event.type));
}

export function listCardTypes() {
  return [...CARD_TYPES];
}

export function listStatuses() {
  return [...STATUSES];
}

export function transitions() {
  return Object.fromEntries(Object.entries(TRANSITIONS).map(([k, v]) => [k, [...v]]));
}

export function _reset() {
  cards.clear();
}

export const toolcards = {
  build,
  update,
  status,
  get,
  list,
  openCount,
  cardTypeFor,
  isToolEvent,
  fingerprint,
  listCardTypes,
  listStatuses,
  transitions,
  _reset,
};

export default toolcards;
