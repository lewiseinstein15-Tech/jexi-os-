// prompt/testing/assertions.js
// Phase 25 — Scope K: the four prompt assertions.
//
//   { kind: 'contains',      value: string }
//   { kind: 'not-contains',  value: string }
//   { kind: 'matches-schema', schema: JSONSchema }
//   { kind: 'within-budget', maxChars: number }
//
// Every assertion runs on the BUILT PROMPT STRING only (RULE 7 — no LLM
// calls, no hidden I/O). Every FAILURE names the assertion and shows
// expected vs actual (RULE 5 — no swallowing): the result object always
// carries { index, kind, passed, expected, actual } and a message on fail.
//
// matches-schema validates the prompt string AS a JSON payload against a
// JSON-Schema subset, implemented locally (zero dependencies):
//   type (string|number|integer|boolean|object|array|null), enum,
//   required, properties, additionalProperties:false, items,
//   minItems, maxItems, minLength, maxLength, minimum, maximum, pattern
// Unsupported keywords are ignored (documented subset, not a guess).
//
// Deterministic (RULE 4): pure functions of (assertion, subject).

/** The full assertion surface (frozen; order = canonical execution order). */
export const ASSERTION_KINDS = Object.freeze([
  'contains',
  'not-contains',
  'matches-schema',
  'within-budget',
]);

/** Machine-readable codes for the testing zone (Scope K). */
export const TESTING_CODES = Object.freeze({
  INVALID_TEST_SPEC: 'E_INVALID_TEST_SPEC',
  INVALID_ASSERTION: 'E_INVALID_ASSERTION',
  NO_SUCH_TEST: 'E_NO_SUCH_TEST',
  INVALID_RUN_OPTS: 'E_INVALID_RUN_OPTS',
});

function jsonTypeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // 'string' | 'number' | 'boolean' | 'object' | ...
}

/**
 * Validate `value` against the supported JSON-Schema subset.
 * Returns an array of { path, message } — empty means valid.
 */
export function validateJsonSchema(value, schema, at = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [{ path: at, message: 'schema must be a plain object' }];
  }
  if (schema.type !== undefined) {
    const wanted = schema.type;
    const actual = jsonTypeOf(value);
    const ok =
      wanted === 'integer'
        ? typeof value === 'number' && Number.isInteger(value)
        : wanted === 'number'
          ? typeof value === 'number' && !Number.isNaN(value)
          : actual === wanted;
    if (!ok) errors.push({ path: at, message: `expected type ${wanted}, got ${actual}` });
  }
  if (Array.isArray(schema.enum)) {
    const hit = schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value));
    if (!hit) {
      errors.push({
        path: at,
        message: `expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`,
      });
    }
  }
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
  const isArray = Array.isArray(value);
  if (isObject) {
    for (const req of schema.required || []) {
      if (typeof req !== 'string') continue;
      if (!Object.prototype.hasOwnProperty.call(value, req)) {
        errors.push({ path: at, message: `missing required property "${req}"` });
      }
    }
    const props = schema.properties || {};
    for (const [key, sub] of Object.entries(props)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validateJsonSchema(value[key], sub, `${at}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) {
          errors.push({ path: `${at}.${key}`, message: 'unexpected property' });
        }
      }
    }
  }
  if (isArray) {
    if (schema.items) {
      value.forEach((item, idx) => {
        errors.push(...validateJsonSchema(item, schema.items, `${at}[${idx}]`));
      });
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({ path: at, message: `expected at least ${schema.minItems} items, got ${value.length}` });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({ path: at, message: `expected at most ${schema.maxItems} items, got ${value.length}` });
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path: at, message: `expected minLength ${schema.minLength}, got length ${value.length}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path: at, message: `expected maxLength ${schema.maxLength}, got length ${value.length}` });
    }
    if (schema.pattern !== undefined) {
      let re;
      try {
        re = new RegExp(schema.pattern);
      } catch {
        errors.push({ path: at, message: `schema.pattern is not a valid regex: ${String(schema.pattern)}` });
        re = null;
      }
      if (re && !re.test(value)) {
        errors.push({ path: at, message: `expected match for /${schema.pattern}/` });
      }
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path: at, message: `expected >= ${schema.minimum}, got ${value}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path: at, message: `expected <= ${schema.maximum}, got ${value}` });
    }
  }
  return errors;
}

/** Validate one assertion object's shape; returns an error string or null. */
export function assertAssertionShape(assertion) {
  if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) {
    return 'assertion must be a plain object';
  }
  if (!ASSERTION_KINDS.includes(assertion.kind)) {
    return `assertion.kind must be one of ${ASSERTION_KINDS.join(' | ')}`;
  }
  if (assertion.kind === 'contains' || assertion.kind === 'not-contains') {
    if (typeof assertion.value !== 'string') return `assertion.value must be a string for kind ${assertion.kind}`;
  } else if (assertion.kind === 'matches-schema') {
    if (!assertion.schema || typeof assertion.schema !== 'object' || Array.isArray(assertion.schema)) {
      return 'assertion.schema must be a plain object (JSON Schema subset)';
    }
  } else if (assertion.kind === 'within-budget') {
    if (!Number.isInteger(assertion.maxChars) || assertion.maxChars < 0) {
      return 'assertion.maxChars must be a non-negative integer';
    }
  }
  return null;
}

/**
 * Run ONE assertion against the subject string.
 * Returns { index, kind, passed, expected, actual, message? } — the fail
 * path ALWAYS names the assertion and shows expected vs actual (RULE 5).
 */
export function runAssertion(assertion, subject, index = 0) {
  const shapeErr = assertAssertionShape(assertion);
  if (shapeErr) {
    return {
      index,
      kind: assertion && assertion.kind ? String(assertion.kind) : 'unknown',
      passed: false,
      expected: 'a well-formed assertion',
      actual: shapeErr,
      message: `assertion #${index} is malformed: ${shapeErr}`,
    };
  }
  const subjectChars = subject.length;
  if (assertion.kind === 'contains') {
    const present = subject.includes(assertion.value);
    return {
      index,
      kind: 'contains',
      passed: present,
      expected: { contains: assertion.value },
      actual: { present, promptChars: subjectChars },
      ...(present
        ? {}
        : {
            message: `assertion #${index} contains FAILED - expected prompt to contain ${JSON.stringify(
              assertion.value
            )}; not found in ${subjectChars} chars`,
          }),
    };
  }
  if (assertion.kind === 'not-contains') {
    const count = subject.split(assertion.value).length - 1;
    const passed = count === 0;
    return {
      index,
      kind: 'not-contains',
      passed,
      expected: { absent: assertion.value },
      actual: { present: count > 0, occurrences: count, promptChars: subjectChars },
      ...(passed
        ? {}
        : {
            message: `assertion #${index} not-contains FAILED - expected ${JSON.stringify(
              assertion.value
            )} to be absent; found ${count} occurrence(s)`,
          }),
    };
  }
  if (assertion.kind === 'matches-schema') {
    let parsed;
    try {
      parsed = JSON.parse(subject);
    } catch (e) {
      return {
        index,
        kind: 'matches-schema',
        passed: false,
        expected: { schema: assertion.schema },
        actual: { parseError: String((e && e.message) || e) },
        message: `assertion #${index} matches-schema FAILED - prompt is not valid JSON: ${String(
          (e && e.message) || e
        )}`,
      };
    }
    const errors = validateJsonSchema(parsed, assertion.schema);
    const passed = errors.length === 0;
    return {
      index,
      kind: 'matches-schema',
      passed,
      expected: { schema: assertion.schema },
      actual: passed ? { valid: true } : { errors },
      ...(passed
        ? {}
        : {
            message: `assertion #${index} matches-schema FAILED - ${errors.length} schema violation(s): ${errors
              .map((x) => `${x.path}: ${x.message}`)
              .join('; ')}`,
          }),
    };
  }
  // within-budget
  const chars = subjectChars;
  const passed = chars <= assertion.maxChars;
  return {
    index,
    kind: 'within-budget',
    passed,
    expected: { maxChars: assertion.maxChars },
    actual: passed
      ? { chars, underBy: assertion.maxChars - chars }
      : { chars, overBy: chars - assertion.maxChars },
    ...(passed
      ? {}
      : {
          message: `assertion #${index} within-budget FAILED - expected <= ${assertion.maxChars} chars, got ${chars} (over by ${
            chars - assertion.maxChars
          })`,
        }),
  };
}
