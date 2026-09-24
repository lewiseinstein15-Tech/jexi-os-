/**
 * JEXI OS — benchmarks/webarena/observation.js
 *
 * wa.observe(rawDom) -> { url, visibleText, focus, a11y }
 *
 * `rawDom` is a DOM snapshot as captured by the runner side (Phase 17
 * browser runtime in the real run; fixture JSON in the sandbox):
 *   { url: string, visibleText?: string,
 *     focus?: { element_id, role?, name? } | null,
 *     a11y?: [ { element_id, role, name? }, ... ] }
 *
 * Normalization contract (frozen):
 * - the output has EXACTLY the four WebArena observation keys — url,
 *   visibleText, focus, a11y — extra snapshot keys (title, timestamp,
 *   viewport, ...) are dropped so downstream consumers see one shape;
 * - visibleText is preserved byte-for-byte (never trimmed, never
 *   collapsed) and defaults to '' when absent;
 * - focus defaults to null; when present it must carry a non-empty
 *   string element_id (role/name optional strings);
 * - a11y defaults to []; every node must carry a non-empty string
 *   element_id and role (name optional string); nodes are normalized to
 *   { element_id, role, name? }.
 *
 * Misuse (non-object snapshot, missing/blank url, ill-typed fields)
 * throws E_INVALID_OBSERVATION rather than silently coercing.
 *
 * Deterministic: pure validation + shape projection, no wall-clock,
 * no randomness.
 */

function invalidObservation(reason) {
  const err = new Error(`E_INVALID_OBSERVATION — ${reason}`);
  err.code = 'E_INVALID_OBSERVATION';
  return err;
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function observe(rawDom) {
  if (!isPlainObject(rawDom)) {
    throw invalidObservation('raw DOM snapshot must be an object { url, visibleText?, focus?, a11y? }');
  }
  if (typeof rawDom.url !== 'string' || rawDom.url.trim() === '') {
    throw invalidObservation('url must be a non-empty string');
  }
  const visibleText = rawDom.visibleText === undefined ? '' : rawDom.visibleText;
  if (typeof visibleText !== 'string') {
    throw invalidObservation('visibleText must be a string');
  }
  let focus = rawDom.focus === undefined ? null : rawDom.focus;
  if (focus !== null) {
    if (!isPlainObject(focus) || typeof focus.element_id !== 'string' || focus.element_id === '') {
      throw invalidObservation('focus must be null or an object with a non-empty string element_id');
    }
    if (focus.role !== undefined && typeof focus.role !== 'string') {
      throw invalidObservation('focus.role must be a string when present');
    }
    if (focus.name !== undefined && typeof focus.name !== 'string') {
      throw invalidObservation('focus.name must be a string when present');
    }
  }
  const a11y = rawDom.a11y === undefined ? [] : rawDom.a11y;
  if (!Array.isArray(a11y)) {
    throw invalidObservation('a11y must be an array of accessibility nodes');
  }
  a11y.forEach((node, i) => {
    if (!isPlainObject(node)) {
      throw invalidObservation(`a11y[${i}] must be an object`);
    }
    if (typeof node.element_id !== 'string' || node.element_id === '') {
      throw invalidObservation(`a11y[${i}].element_id must be a non-empty string`);
    }
    if (typeof node.role !== 'string' || node.role === '') {
      throw invalidObservation(`a11y[${i}].role must be a non-empty string`);
    }
    if (node.name !== undefined && typeof node.name !== 'string') {
      throw invalidObservation(`a11y[${i}].name must be a string when present`);
    }
  });
  return {
    url: rawDom.url,
    visibleText,
    focus,
    a11y: a11y.map((n) => ({
      element_id: n.element_id,
      role: n.role,
      ...(n.name !== undefined ? { name: n.name } : {}),
    })),
  };
}

/** The set of element_ids visible in a parsed observation — the DOM
 *  ground truth the adapter validates click/type/hover targets against. */
export function elementSet(observation) {
  return new Set(observation.a11y.map((n) => n.element_id));
}
