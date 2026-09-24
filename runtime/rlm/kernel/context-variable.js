/** Named prompt/data slots. Values are JSON data; callers never share references. */
export function copy(value) {
  const seen = new Set();
  function check(v) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v !== 'object' || seen.has(v)) throw new TypeError('RLM_CONTEXT_JSON_REQUIRED');
    seen.add(v);
    if (!Array.isArray(v) && Object.prototype.toString.call(v) !== '[object Object]') throw new TypeError('RLM_CONTEXT_JSON_REQUIRED');
    for (const k of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && k === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (typeof k !== 'string' || !d.enumerable || !('value' in d)) throw new TypeError('RLM_CONTEXT_JSON_REQUIRED');
      check(d.value);
    }
    seen.delete(v);
  }
  check(value);
  return JSON.parse(JSON.stringify(value));
}
export class ContextVariable {
  #slots = new Map();
  set(name, value) {
    if (typeof name !== 'string' || !name.length || name.length > 256) throw new TypeError('RLM_CONTEXT_NAME');
    this.#slots.set(name, copy(value));
    return this.get(name);
  }
  get(name) { return this.#slots.has(name) ? copy(this.#slots.get(name)) : undefined; }
  list() { return [...this.#slots.keys()].sort(); }
  snapshot() { return this.list().map(name => [name, this.get(name)]); }
  restore(entries) {
    const next = new ContextVariable();
    for (const [name, value] of entries) next.set(name, value);
    this.#slots = next.#slots;
    return this;
  }
}
export default ContextVariable;
