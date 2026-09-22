/** JEXI OS — Phase 30 Scope E — worktree hook emission through Scope A. */
import { SemanticaError } from '../../../semantica/_internal.js';
import hooks from '../hooks/index.js';

const WORKTREE_EVENTS = new Set(['WorktreeCreate', 'WorktreeRemove']);
const clone = (value) => JSON.parse(JSON.stringify(value));

export function createWorktreeHookEmitter() {
  const invocations = [];

  return Object.freeze({
    emit(event, payload) {
      if (!WORKTREE_EVENTS.has(event)) {
        throw new SemanticaError('E_UNKNOWN_HOOK_EVENT', `unsupported worktree hook event ${JSON.stringify(event)}`);
      }
      const spec = hooks.get(event);
      const invocation = {
        event: spec.event,
        lifecycle: spec.lifecycle,
        matcher: spec.matcher,
        timeout: spec.timeout,
        async: spec.async,
        contract: spec.contract,
        stub: spec.stub,
        handlerCount: spec.handlers.length,
        payload: clone(payload),
      };
      invocations.push(clone(invocation));
      return clone(invocation);
    },

    list() {
      return invocations.map(clone);
    },
  });
}
