/**
 * B138 — CODE RUNTIME BOOTSTRAP (DeepSeek Harness
 * `packages/code-runtime/code-runtime-worker-thread` mirror: bootstrap,
 * output-json, worker-json, protocol — JEXI-branded).
 *
 * Worker bootstrap hardening for JEXI's code runtime (code-worker.js):
 * strict JSON-only snapshots, byte budgets with an explicit output-limit
 * signal, and protocol-message validation so a malformed worker frame fails
 * closed instead of being parsed leniently.
 *
 *   jsonSnapshot(value)            — JSON-only value snapshot (no BigInt, no
 *                                    functions, no circular refs).
 *   byteBudget(text, limit)        — truncate at a byte budget, marking
 *                                    overflow with the DSH-style note.
 *   validateWorkerMessage(msg)     — { type: 'start'|'log'|'output-limit'|
 *                                    'done', ... } with type required.
 *   workerBootstrapSelfCheck()     — offline determinism checks used by the
 *                                    headless CLI --self-test.
 */

const TRUNCATED_NOTE = '\n…[output truncated by the code runtime]';

/** Snapshot a value to a JSON-only deep copy; throws on unsafe values. */
export function jsonSnapshot(value, label = 'value') {
  const seen = new Set();
  const visit = (v, key) => {
    if (v === null || v === undefined) return v;
    const t = typeof v;
    if (t === 'number' || t === 'string' || t === 'boolean') return v;
    if (t === 'bigint') throw new Error(`"${key}" contains a BigInt — not JSON-safe`);
    if (t === 'function' || t === 'symbol') throw new Error(`"${key}" contains a ${t} — not JSON-safe`);
    if (t === 'object') {
      if (seen.has(v)) throw new Error(`"${key}" contains a circular reference`);
      seen.add(v);
      if (Array.isArray(v)) {
        const out = [];
        for (let i = 0; i < v.length; i += 1) out.push(visit(v[i], `${key}[${i}]`));
        return out;
      }
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        if (typeof val === 'function' || typeof val === 'symbol' || val === undefined) continue; // JSON.stringify drops these
        out[k] = visit(val, `${key}.${k}`);
      }
      return out;
    }
    throw new Error(`"${key}" has unsupported type ${t}`);
  };
  try {
    return JSON.parse(JSON.stringify(visit(value, label)));
  } catch (e) {
    throw new Error(`jsonSnapshot(${label}) failed: ${e.message}`);
  }
}

/** Truncate text at a BYTE budget (UTF-8 aware), marking overflow. */
export function byteBudget(text, limit = 32768) {
  const s = String(text ?? '');
  if (Buffer.byteLength(s, 'utf8') <= limit) return { text: s, truncated: false };
  let end = s.length;
  while (end > 0 && Buffer.byteLength(s.slice(0, end), 'utf8') > limit) end -= 1;
  return { text: s.slice(0, end) + TRUNCATED_NOTE, truncated: true };
}

/** Worker protocol message types (dsh code-runtime protocol mirror). */
export const WORKER_MESSAGE_TYPES = ['start', 'log', 'output-limit', 'done', 'error'];

/** Validate one worker protocol message; returns { ok } or { ok:false, error }. */
export function validateWorkerMessage(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return { ok: false, error: 'worker message must be a JSON object' };
  }
  const type = msg.type;
  if (typeof type !== 'string' || !WORKER_MESSAGE_TYPES.includes(type)) {
    return { ok: false, error: `worker message type must be one of ${WORKER_MESSAGE_TYPES.join(', ')} (got ${JSON.stringify(type)})` };
  }
  switch (type) {
    case 'start':
      if (typeof msg.code !== 'string') return { ok: false, error: 'start message requires a code string' };
      break;
    case 'log':
      if (typeof msg.text !== 'string') return { ok: false, error: 'log message requires a text string' };
      break;
    case 'done':
      if (!('result' in msg)) return { ok: false, error: 'done message requires a result field' };
      break;
    default:
      break;
  }
  return { ok: true };
}

/** Normalize a worker-produced result to the JSON-only contract. */
export function normalizeWorkerResult(result, { maxResultBytes = 32768 } = {}) {
  const snap = jsonSnapshot(result, 'worker result');
  const serialized = JSON.stringify(snap);
  if (Buffer.byteLength(serialized, 'utf8') > maxResultBytes) {
    return { ok: false, error: `worker result exceeds ${maxResultBytes} bytes` };
  }
  return { ok: true, result: snap };
}

/** Offline self-checks used by cli.js --self-test. */
export function workerBootstrapSelfCheck() {
  const checks = [];
  const check = (name, cond) => checks.push({ name, ok: !!cond });
  check('jsonSnapshot plain object', JSON.stringify(jsonSnapshot({ a: 1, b: ['x', true] })) === '{"a":1,"b":["x",true]}');
  let bigintThrows = false;
  try { jsonSnapshot({ big: 10n }); } catch { bigintThrows = true; }
  check('jsonSnapshot rejects BigInt', bigintThrows);
  let circThrows = false;
  try { const c = {}; c.self = c; jsonSnapshot(c); } catch { circThrows = true; }
  check('jsonSnapshot rejects circular refs', circThrows);
  check('jsonSnapshot drops functions like JSON.stringify', JSON.stringify(jsonSnapshot({ f: () => {}, keep: 1 })) === '{"keep":1}');
  const bb = byteBudget('hello world', 5);
  check('byteBudget truncates at bytes', bb.truncated === true && bb.text.startsWith('hello'));
  check('validateWorkerMessage ok', validateWorkerMessage({ type: 'log', text: 'x' }).ok === true);
  check('validateWorkerMessage rejects bad type', validateWorkerMessage({ type: 'nope' }).ok === false);
  check('validateWorkerMessage rejects null', validateWorkerMessage(null).ok === false);
  const norm = normalizeWorkerResult({ deep: { ok: true } });
  check('normalizeWorkerResult roundtrip', norm.ok && norm.result.deep.ok === true);
  const big = normalizeWorkerResult({ pad: 'x'.repeat(40000) }, { maxResultBytes: 100 });
  check('normalizeWorkerResult rejects oversized', big.ok === false);
  return checks;
}
