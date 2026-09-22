/** JEXI OS — Phase 30 Scope F — fail-closed slash-command expansion hook. */
import { SemanticaError } from '../../../semantica/_internal.js';
import hooks, { HOOK_CATALOG } from '../hooks/index.js';

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const safeError = (error) => ({
  name: error?.name ?? 'Error',
  code: error?.code ?? null,
  message: error?.message ?? String(error),
});

function fail(code, message) {
  return new SemanticaError(code, message);
}

function catalogSpec() {
  const runtime = hooks.get('UserPromptExpansion');
  const declared = HOOK_CATALOG.find((entry) => entry.event === 'UserPromptExpansion');
  return {
    event: runtime.event,
    lifecycle: runtime.lifecycle,
    matcher: runtime.matcher,
    timeout: runtime.timeout,
    declaredReturn: declared?.declaredReturn ?? null,
  };
}

export function createPromptExpansion() {
  let handler = null;
  let handlerCalls = 0;

  function register(next) {
    if (typeof next !== 'function') throw fail('E_INVALID_LIFECYCLE_HANDLER', 'PromptExpansion handler must be a function');
    handler = next;
    return { registered: true };
  }

  function decide(input = {}) {
    const command = input.command ?? input.commandName;
    if (typeof command !== 'string' || command.trim() === '') {
      throw fail('E_INVALID_PROMPT_EXPANSION', 'slash command must be a non-empty string');
    }
    const event = {
      event: 'UserPromptExpansion',
      command,
      arguments: input.arguments ?? null,
      catalog: catalogSpec(),
    };
    if (!handler) {
      return {
        block: true,
        reason: 'prompt expansion denied by default',
        fallback: 'deny',
        handlerCalls,
      };
    }

    try {
      handlerCalls += 1;
      const contract = handler(clone(event));
      if (contract && typeof contract.then === 'function') {
        Promise.resolve(contract).catch(() => {});
        throw fail('E_INVALID_HOOK_RETURN', 'PromptExpansion handlers must be synchronous');
      }
      if (!contract || typeof contract !== 'object' || Array.isArray(contract)
        || (contract.block !== undefined && typeof contract.block !== 'boolean')
        || (contract.reason !== undefined && typeof contract.reason !== 'string')) {
        throw fail('E_INVALID_HOOK_RETURN', 'PromptExpansion handler must return { block?: boolean, reason?: string }');
      }
      const block = contract.block !== false;
      return {
        block,
        reason: block ? (contract.reason || 'blocked by prompt expansion hook') : null,
        handlerCalls,
      };
    } catch (error) {
      return {
        block: true,
        reason: 'PromptExpansion hook error; denied by default',
        fallback: 'deny',
        handlerCalls,
        error: safeError(error),
      };
    }
  }

  async function handle(input, { run } = {}) {
    const decision = decide(input);
    if (decision.block) return { ...decision, executed: false };
    if (typeof run !== 'function') {
      return {
        ...decision,
        block: true,
        reason: 'slash command runner unavailable; denied by default',
        fallback: 'deny',
        executed: false,
      };
    }
    const result = await run(clone(input));
    return { ...decision, executed: true, result: clone(result) };
  }

  function reset() {
    handler = null;
    handlerCalls = 0;
    return { reset: true };
  }

  return Object.freeze({ register, decide, handle, reset });
}

export const PromptExpansion = createPromptExpansion();
export default PromptExpansion;
