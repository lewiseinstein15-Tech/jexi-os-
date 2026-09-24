/**
 * JEXI OS — Phase 15 Scope B — relay entry point.
 *
 *   const relay = createRelay(relayDir)
 *   relay.attach(adapter)            -> { registered, name }
 *   relay.write({ from, task, state }) -> { handoffId }
 *   relay.read(handoffId)            -> { handoffId, from, task, state, resumedBy? }
 *   relay.resume(handoffId, by)      -> { resumed, at }
 *   relay.warRoom(id)                -> { id, participants, messages }
 *   relay.join(id, by) / relay.post(id, { by, text })
 *
 * Agent identity comes ONLY from attached adapters. `at` on resume is
 * a monotonic op counter (op-seq.txt), never a clock — determinism.
 * Reuses SemanticaError/fail from Phase 14 (read-only import).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../../semantica/_internal.js';
import { writeHandoff, readHandoff, resumeHandoff, nextSeq } from './handoff.js';
import { readRoom, joinRoom, postMessage } from './war-room.js';

export function createRelay(relayDir) {
  if (typeof relayDir !== 'string' || relayDir.trim() === '') {
    throw fail('E_INVALID_ARGUMENT', 'relayDir must be a non-empty string');
  }
  fs.mkdirSync(relayDir, { recursive: true });
  const registry = new Map();
  const isRegistered = (name) => registry.has(name);
  const nextOp = () => nextSeq(relayDir, 'op');
  return {
    path: relayDir,
    attach(adapter) {
      if (!adapter || typeof adapter !== 'object' || typeof adapter.name !== 'string' || adapter.name.trim() === '') {
        throw fail('E_INVALID_ADAPTER', 'adapter must be an object with a non-empty name');
      }
      registry.set(adapter.name, adapter);
      return { registered: true, name: adapter.name };
    },
    isRegistered,
    write: (spec) => writeHandoff(relayDir, isRegistered, spec),
    read: (handoffId) => readHandoff(relayDir, handoffId),
    resume: (handoffId, by) => resumeHandoff(relayDir, isRegistered, nextOp, handoffId, by),
    warRoom: (id) => readRoom(relayDir, id),
    join(id, by) {
      if (!isRegistered(by)) throw fail('E_UNKNOWN_AGENT', 'no adapter registered as ' + JSON.stringify(by));
      return joinRoom(relayDir, id, by);
    },
    post(id, msg) {
      if (!msg || !isRegistered(msg.by)) throw fail('E_UNKNOWN_AGENT', 'no adapter registered as ' + JSON.stringify(msg && msg.by));
      return postMessage(relayDir, id, msg);
    },
  };
}

export { claudeCode } from './claude-code.js';
export { codex } from './codex.js';
export { writeHandoff, readHandoff, resumeHandoff } from './handoff.js';
export { readRoom, joinRoom, postMessage } from './war-room.js';
export { SemanticaError } from '../../semantica/_internal.js';
