import vm from 'node:vm';
import { format } from 'node:util';
import { ContextVariable, copy } from './context-variable.js';

/** Trusted synchronous agent code only. node:vm is NOT a security boundary.
 * One lexical namespace per instance; snapshots replay cells, never host I/O.
 */
export class PersistentRepl {
  #vm; #journal = []; #output = ''; #tainted = false;
  constructor({ timeout = 1000, maxOutput = 65536 } = {}) {
    if (!Number.isInteger(timeout) || timeout < 1 || !Number.isInteger(maxOutput) || maxOutput < 1) throw new TypeError('RLM_LIMITS');
    this.timeout = timeout;
    this.maxOutput = maxOutput;
    this.context = new ContextVariable();
    const sandbox = Object.create(null);
    const emit = (...args) => { this.#output = (this.#output + format(...args) + '\n').slice(0, this.maxOutput); };
    Object.defineProperties(sandbox, {
      context: { value: Object.freeze({ set: this.context.set.bind(this.context), get: this.context.get.bind(this.context), list: this.context.list.bind(this.context) }) },
      console: { value: Object.freeze({ log: emit, info: emit, warn: emit, error: emit }) },
      ctx: { value: {}, writable: true },
    });
    this.#vm = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
  }
  eval(code, ctx = {}) {
    this.#output = '';
    let inputs;
    try {
      if (typeof code !== 'string') throw new TypeError('RLM_CODE_STRING_REQUIRED');
      inputs = copy(ctx);
    } catch (e) { return { result: undefined, output: '', error: { name: e.name, message: e.message } }; }
    const before = this.context.snapshot();
    let response;
    try {
      // Inject JSON into the VM realm rather than retaining caller objects.
      new vm.Script(`ctx = JSON.parse(${JSON.stringify(JSON.stringify(inputs))})`).runInContext(this.#vm, { timeout: this.timeout });
      const value = new vm.Script(code, { filename: `rlm-cell-${this.#journal.length + 1}.js` }).runInContext(this.#vm, { timeout: this.timeout });
      // Do not silently treat promises/functions/resources as durable results.
      const result = value === undefined ? undefined : copy(value);
      response = { result, output: this.#output };
    } catch (e) {
      if (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || e.message === 'RLM_CONTEXT_JSON_REQUIRED') this.#tainted = true;
      response = { result: undefined, output: this.#output, error: { name: e.name, message: e.message } };
    }
    this.#journal.push({ code, ctx: inputs, before, response: JSON.stringify(response) });
    return response;
  }
  snapshot() {
    if (this.#tainted) throw new Error('RLM_SNAPSHOT_UNSUPPORTED_STATE');
    const snapshot = { version: 1, timeout: this.timeout, maxOutput: this.maxOutput, journal: copy(this.#journal), slots: this.context.snapshot() };
    // Fail now, not at restart, if observable replay diverges.
    PersistentRepl.restore(snapshot);
    return snapshot;
  }
  static restore(snapshot) {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.journal) || !Array.isArray(snapshot.slots)) throw new Error('RLM_SNAPSHOT_INVALID');
    const repl = new PersistentRepl(snapshot);
    for (const cell of snapshot.journal) {
      repl.context.restore(cell.before);
      const response = repl.eval(cell.code, cell.ctx);
      if (JSON.stringify(response) !== cell.response || repl.#tainted) throw new Error('RLM_SNAPSHOT_REPLAY_DIVERGED');
    }
    repl.context.restore(snapshot.slots);
    return repl;
  }
}
export default PersistentRepl;
