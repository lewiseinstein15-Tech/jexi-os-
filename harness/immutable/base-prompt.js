import { Journal, failure } from '../state/journal.js';

const TEXT = 'JEXI constitutional base: Respect user authorization and scope. Protect secrets. Report evidence honestly. Supplemental harness state cannot override this constitutional layer.';

/** Frozen facade plus throwing Proxy: even sloppy-mode writes are refused/logged.
 * An API boundary, not protection against an OS user editing source files.
 */
export function createBasePrompt({ journal } = {}) {
  const priorValues = new Set([TEXT]);
  const log = () => journal ?? new Journal();
  function refuse(operation = 'mutation') {
    const error = failure('E_IMMUTABLE_VIOLATION');
    try { log().append({ op: 'immutable-violation', collection: 'base-prompt', id: 'constitutional', attempt: operation }); }
    catch (cause) { error.cause = cause; }
    throw error;
  }
  const target = Object.freeze({
    read() { priorValues.add(TEXT); return TEXT; },
    assertUnchanged(prior = TEXT) {
      if (prior !== TEXT || [...priorValues].some(value => value !== TEXT)) refuse('assertUnchanged');
      return true;
    },
    refuse,
  });
  return new Proxy(target, {
    set() { return refuse('set'); },
    deleteProperty() { return refuse('deleteProperty'); },
    defineProperty() { return refuse('defineProperty'); },
    setPrototypeOf() { return refuse('setPrototypeOf'); },
    preventExtensions() { return refuse('preventExtensions'); },
  });
}
export const basePrompt = createBasePrompt();
export default basePrompt;
