/**
 * JEXI OS — Phase 28 Scope H — live v1 conformance certification.
 * Validates all five verb handlers and the exact success/error envelope.
 */
import { SemanticaError } from '../../semantica/_internal.js';
import { inspectEnvelope } from './envelope.js';
import { VERB_DEFINITIONS, VERB_NAMES } from './verbs.js';

const FROZEN_SIGNATURES = Object.freeze({
  recall: Object.freeze({ signature: 'recall({ query, opts })', required: 'query' }),
  remember: Object.freeze({ signature: 'remember({ content, kind, sourceId })', required: 'content,kind,sourceId' }),
  entity: Object.freeze({ signature: 'entity({ name })', required: 'name' }),
  synthesize: Object.freeze({ signature: 'synthesize({ query })', required: 'query' }),
  forget: Object.freeze({ signature: 'forget({ id })', required: 'id' }),
});

function fail(field, message) {
  throw new SemanticaError('E_CONFORMANCE_FAIL', `${field}: ${message}`);
}

export function assertConformantEnvelope(envelope, expectedVerb) {
  const violation = inspectEnvelope(envelope);
  if (violation) fail(`${expectedVerb}.${violation.field}`, violation.message);
  if (envelope.verb !== expectedVerb) fail(`${expectedVerb}.verb`, `expected ${JSON.stringify(expectedVerb)}, got ${JSON.stringify(envelope.verb)}`);
  return true;
}

export function assertFrozenDefinitions() {
  const actual = Object.keys(VERB_DEFINITIONS);
  if (actual.length !== VERB_NAMES.length) fail('verbs.length', `expected ${VERB_NAMES.length}, got ${actual.length}`);
  for (let index = 0; index < VERB_NAMES.length; index += 1) {
    if (actual[index] !== VERB_NAMES[index]) {
      fail(`verbs[${index}]`, `expected ${VERB_NAMES[index]}, got ${actual[index]}`);
    }
    const name = VERB_NAMES[index];
    const expected = FROZEN_SIGNATURES[name];
    if (VERB_DEFINITIONS[name].signature !== expected.signature) {
      fail(`${name}.signature`, `expected ${expected.signature}, got ${VERB_DEFINITIONS[name].signature}`);
    }
    const required = VERB_DEFINITIONS[name].required.join(',');
    if (required !== expected.required) fail(`${name}.required`, `expected ${expected.required}, got ${required}`);
  }
  return true;
}

/**
 * cases is an exact verb->argument map. Conformance is live and may write via
 * remember/forget, matching the protocol's real side effects.
 */
export async function runConformance(protocol, { cases = {}, requireOk = true } = {}) {
  assertFrozenDefinitions();
  const results = [];
  for (const verb of VERB_NAMES) {
    if (!protocol || typeof protocol[verb] !== 'function') fail(`${verb}.handler`, 'missing callable verb');
    if (!Object.prototype.hasOwnProperty.call(cases, verb)) fail(`${verb}.case`, 'missing conformance arguments');
    let envelope;
    try {
      envelope = await protocol[verb](cases[verb]);
    } catch (error) {
      fail(`${verb}.call`, `threw instead of returning an envelope: ${error?.message ?? String(error)}`);
    }
    assertConformantEnvelope(envelope, verb);
    if (requireOk && envelope.ok !== true) fail(`${verb}.ok`, `expected true, got false (${envelope.error?.code ?? 'unknown error'})`);
    results.push({ verb, envelope: 'PASS' });
  }
  return {
    passed: results.length,
    total: VERB_NAMES.length,
    envelope: 'PASS',
    verbs: results,
  };
}
