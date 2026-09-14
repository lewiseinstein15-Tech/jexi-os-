/**
 * JEXI OS — tools — communication domain.
 *
 * notify, ask. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import { emit, recent } from '../../../services/Observer.js';

// Async-by-design question queue (headless): comm_ask records the question and
// returns a handle; a human (or UI) can later answer via the same handle.
const questions = new Map();
let questionSeq = 0;

export function registerCommunicationTools() {
  const defs = [
    defineTool({ name: 'comm_notify', description: 'Emit a user-visible notification onto the event bus.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { message: { type: 'string' }, severity: { type: 'string', enum: ['info', 'warn', 'error'] } }, required: ['message'] }, sideEffects: ['comm'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'comm_ask', description: 'Record a question for a human (async-by-design) and return a handle.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] }, sideEffects: ['comm'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    async comm_notify({ message, severity }, _ctx = {}) {
      const evt = emit('comm.notify', { actor: 'tools', summary: String(message || ''), data: { severity: severity || 'info' } });
      return { ok: Boolean(evt), eventId: evt?.id ?? null, message, severity: severity || 'info', observable: Boolean(recent({ limit: 1 }).length) };
    },
    async comm_ask({ question }, _ctx = {}) {
      const id = `q-${Date.now().toString(36)}-${++questionSeq}`;
      questions.set(id, { question: String(question || ''), at: new Date().toISOString(), answer: null });
      emit('comm.ask', { actor: 'tools', summary: String(question || ''), data: { handle: id } });
      return { ok: true, handle: id, status: 'awaiting-answer' };
    },
  };
  return { unreg, engines };
}
