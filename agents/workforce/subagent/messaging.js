import { assertInScope } from './family.js';
import { copyJson, error, recordFor } from './storage.js';

function iso(clock) {
  const value = new Date(clock());
  if (Number.isNaN(value.valueOf())) throw error('E_CLOCK');
  return value.toISOString();
}

function find(graph, id) {
  return graph?.agents?.find(agent => agent.id === id);
}

function validateMessage(message) {
  if (!message || typeof message !== 'object' || typeof message.kind !== 'string' || !message.kind
    || !Object.hasOwn(message, 'payload')) throw error('E_MESSAGE_SCHEMA');
  return { kind: message.kind, payload: copyJson(message.payload) };
}

export function createMessaging({ graph, storage, clock }) {
  const deliveredThisRuntime = new Set();

  return {
    /**
     * Persist a single envelope before acknowledging it to the sender.
     * A live recipient is deliverable now; it still reads from its FIFO inbox.
     */
    send(from, to, message, agentGraph = graph) {
      const scope = assertInScope(from, to, agentGraph);
      if (!scope.allowed) {
        return { delivered: false, queued: false, errorCode: scope.errorCode, reason: scope.reason };
      }
      const sender = find(agentGraph, from);
      const recipient = find(agentGraph, to);
      const body = validateMessage(message);
      const now = iso(clock);
      const deliverable = recipient.state === 'live';

      return storage.locked(() => {
        const state = recordFor(storage, recipient);
        const envelope = {
          id: `${recipient.id}:${state.nextSeq}`,
          from: sender.id,
          to: recipient.id,
          kind: body.kind,
          payload: body.payload,
          ts: now,
          delivered: deliverable,
        };
        state.nextSeq += 1;
        state.queue.push(envelope);
        const persistedRecipient = { ...recipient };
        if (deliverable) persistedRecipient.lastActivityAt = now;
        state.agent = copyJson(persistedRecipient);
        storage.write(recipient.id, state);

        // Only mutate the caller's in-memory graph after durable acknowledgement.
        sender.lastActivityAt = now;
        if (deliverable) recipient.lastActivityAt = now;
        return { delivered: deliverable, queued: !deliverable, messageId: envelope.id };
      });
    },

    /** Drain the FIFO queue into durable inflight state and return its messages. */
    receive(agentId) {
      const agent = find(graph, agentId);
      if (!agent) throw error('E_AGENT_NOT_FOUND');
      if (agent.state !== 'live') return [];

      return storage.locked(() => {
        const state = storage.read(agentId);
        if (!state) return [];
        const candidates = [...state.inflight, ...state.queue];
        const messages = candidates
          .filter(envelope => !deliveredThisRuntime.has(envelope.id))
          .map(envelope => ({ ...envelope, delivered: true }));
        if (!messages.length) return [];

        // Keep the durable receipt set until the caller acknowledges it. A fresh
        // process will see it again, so clients can safely deduplicate by id.
        state.inflight = candidates.map(envelope => ({ ...envelope, delivered: true }));
        state.queue = [];
        const now = iso(clock);
        agent.lastActivityAt = now;
        state.agent = copyJson(agent);
        storage.write(agentId, state);
        messages.forEach(envelope => deliveredThisRuntime.add(envelope.id));
        return copyJson(messages);
      });
    },

    /** Optional completion acknowledgement for consumers that no longer need replay. */
    ack(agentId, messageIds) {
      if (!Array.isArray(messageIds) || messageIds.some(id => typeof id !== 'string')) throw error('E_MESSAGE_IDS');
      return storage.locked(() => {
        const state = storage.read(agentId);
        if (!state) throw error('E_AGENT_NOT_FOUND');
        const acknowledged = new Set(messageIds);
        const before = state.inflight.length;
        state.inflight = state.inflight.filter(envelope => !acknowledged.has(envelope.id));
        storage.write(agentId, state);
        return { acknowledged: before - state.inflight.length };
      });
    },
  };
}
