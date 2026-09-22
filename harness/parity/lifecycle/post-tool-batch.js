/** JEXI OS — Phase 30 Scope F — one post hook per parallel tool batch. */
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
  const runtime = hooks.get('PostToolBatch');
  const declared = HOOK_CATALOG.find((entry) => entry.event === 'PostToolBatch');
  return {
    event: runtime.event,
    lifecycle: runtime.lifecycle,
    matcher: runtime.matcher,
    timeout: runtime.timeout,
    declaredReturn: declared?.declaredReturn ?? null,
  };
}

function publicResult(result, index) {
  if (result.status === 'fulfilled') {
    return { index, status: 'fulfilled', value: clone(result.value) };
  }
  return { index, status: 'rejected', error: safeError(result.reason) };
}

export function createPostToolBatch() {
  let handler = null;
  let handlerCalls = 0;
  let batchSequence = 0;
  const events = [];

  function register(next) {
    if (typeof next !== 'function') throw fail('E_INVALID_LIFECYCLE_HANDLER', 'PostToolBatch handler must be a function');
    handler = next;
    return { registered: true };
  }

  async function run(tools, options = {}) {
    if (!Array.isArray(tools) || tools.some((tool) => typeof tool !== 'function')) {
      throw fail('E_INVALID_TOOL_BATCH', 'PostToolBatch tools must be an array of functions');
    }
    const settled = await Promise.allSettled(tools.map((tool) => Promise.resolve().then(() => tool())));
    const results = settled.map(publicResult);
    batchSequence += 1;
    const event = {
      event: 'PostToolBatch',
      batchId: options.batchId ?? `batch-${batchSequence}`,
      toolCount: tools.length,
      statuses: results.map((result) => result.status),
      catalog: catalogSpec(),
    };
    events.push(clone(event));

    let hookResult;
    if (!handler) {
      hookResult = {
        ok: false,
        reason: 'post-tool batch denied by default',
        fallback: 'deny',
        handlerCalls,
      };
    } else {
      try {
        handlerCalls += 1;
        const contract = await handler(clone(event));
        if (!contract || typeof contract !== 'object' || Array.isArray(contract)
          || typeof contract.ok !== 'boolean') {
          throw fail('E_INVALID_HOOK_RETURN', 'PostToolBatch handler must return { ok: boolean }');
        }
        hookResult = { ok: contract.ok, handlerCalls };
      } catch (error) {
        hookResult = {
          ok: false,
          reason: 'PostToolBatch hook error; denied by default',
          fallback: 'deny',
          handlerCalls,
          error: safeError(error),
        };
      }
    }

    return {
      ok: hookResult.ok,
      results,
      hookResult,
      eventCount: events.length,
    };
  }

  function emitted() {
    return events.map(clone);
  }

  function reset() {
    handler = null;
    handlerCalls = 0;
    batchSequence = 0;
    events.length = 0;
    return { reset: true };
  }

  return Object.freeze({ register, run, emitted, reset });
}

export const PostToolBatch = createPostToolBatch();
export default PostToolBatch;
