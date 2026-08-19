/**
 * B138 — TYPING PROTOCOL (DeepSeek Harness `packages/typert/protocol` mirror,
 * JEXI-branded).
 *
 * JEXI's editor wire protocol: a small set of validated messages for driving
 * a text buffer programmatically (the "typing" surface the model can use to
 * edit a document cell by cell).
 *
 *   validateTypingMessage(msg) — { type: 'open'|'insert'|'delete'|'cursor'|
 *                                 'close', ... } with per-type validation.
 *   applyTypingOp(buffer, op)  — pure buffer transformation (insert/delete
 *                                at a bounded position, cursor clamp).
 *
 * Pure functions only — no I/O, no state — so the protocol is trivially
 * testable and safe to call from the code runtime.
 */

export const TYPING_MESSAGE_TYPES = ['open', 'insert', 'delete', 'cursor', 'close'];

/** Validate one typing-protocol message. */
export function validateTypingMessage(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return { ok: false, error: 'typing message must be a JSON object' };
  }
  const type = msg.type;
  if (typeof type !== 'string' || !TYPING_MESSAGE_TYPES.includes(type)) {
    return { ok: false, error: `typing message type must be one of ${TYPING_MESSAGE_TYPES.join(', ')}` };
  }
  switch (type) {
    case 'open':
      if (typeof msg.bufferId !== 'string' || !msg.bufferId) return { ok: false, error: 'open requires a bufferId' };
      if (msg.content !== undefined && typeof msg.content !== 'string') return { ok: false, error: 'open content must be a string' };
      break;
    case 'insert':
      if (typeof msg.text !== 'string') return { ok: false, error: 'insert requires a text string' };
      if (msg.pos !== undefined && (!Number.isInteger(msg.pos) || msg.pos < 0)) return { ok: false, error: 'insert pos must be a non-negative integer' };
      break;
    case 'delete':
      if (!Number.isInteger(msg.count) || msg.count <= 0) return { ok: false, error: 'delete requires a positive integer count' };
      if (msg.pos !== undefined && (!Number.isInteger(msg.pos) || msg.pos < 0)) return { ok: false, error: 'delete pos must be a non-negative integer' };
      break;
    case 'cursor':
      if (!Number.isInteger(msg.pos) || msg.pos < 0) return { ok: false, error: 'cursor pos must be a non-negative integer' };
      break;
    case 'close':
      if (typeof msg.bufferId !== 'string' || !msg.bufferId) return { ok: false, error: 'close requires a bufferId' };
      break;
    default:
      break;
  }
  return { ok: true };
}

/** Clamp a position into [0, len]. */
export function clampPos(pos, len) {
  return Math.max(0, Math.min(Number(pos) || 0, len));
}

/**
 * Apply one typing op to a buffer (pure).
 * @returns {operation:'insert'|'delete'|'cursor'|'open'|'close', buffer, cursor?}
 */
export function applyTypingOp(buffer, op) {
  const validated = validateTypingMessage(op);
  if (!validated.ok) throw new Error(validated.error);
  switch (op.type) {
    case 'open':
      return { operation: 'open', buffer: String(op.content ?? '') };
    case 'insert': {
      const text = String(op.text);
      const pos = clampPos(op.pos, buffer.length);
      return { operation: 'insert', buffer: buffer.slice(0, pos) + text + buffer.slice(pos), cursor: pos + text.length };
    }
    case 'delete': {
      const pos = clampPos(op.pos, buffer.length);
      const count = Math.min(Number(op.count), buffer.length - pos);
      return { operation: 'delete', buffer: buffer.slice(0, pos) + buffer.slice(pos + count), cursor: pos };
    }
    case 'cursor':
      return { operation: 'cursor', buffer, cursor: clampPos(op.pos, buffer.length) };
    case 'close':
      return { operation: 'close', buffer };
    default:
      throw new Error(`unsupported typing op ${op.type}`);
  }
}

/** Apply a script of typing ops to a starting buffer (pure). */
export function applyTypingScript(buffer, ops) {
  let current = String(buffer ?? '');
  const log = [];
  for (const op of ops || []) {
    const r = applyTypingOp(current, op);
    current = r.buffer;
    log.push({ operation: r.operation, cursor: r.cursor ?? null });
  }
  return { buffer: current, log };
}
