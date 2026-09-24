/**
 * JEXI OS — Phase 26 Scope B — instinct schema + validation.
 *
 * Instinct shape (declared contract):
 *   { id, projectId, action, evidence[], examples[],
 *     confidence, firstSeenAt, lastSeenAt,
 *     reinforceCount, contradictCount }
 * validate() never throws — it returns { valid, errors? } with the
 * offending FIELD NAMES. create() throws E_INVALID_INSTINCT naming
 * every missing/invalid field. Confidence at creation is computed by
 * the declared formula (see confidence.js) — never fabricated.
 */
import { fail } from '../../../services/semantica/_internal.js';
import { assertProjectId } from '../observe/scope.js';
import { computeConfidence } from './confidence.js';
import { nextOp } from '../observe/queue.js';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'instinct';

export function validate(instinct) {
  const errors = [];
  if (!instinct || typeof instinct !== 'object' || Array.isArray(instinct)) {
    return { valid: false, errors: [{ field: 'instinct', message: 'must be a plain object' }] };
  }
  const needStr = (f) => { if (typeof instinct[f] !== 'string' || instinct[f].trim() === '') errors.push({ field: f, message: 'must be a non-empty string' }); };
  const needArr = (f) => { if (!Array.isArray(instinct[f])) errors.push({ field: f, message: 'must be an array' }); };
  const needInt = (f) => { if (typeof instinct[f] !== 'number' || !Number.isInteger(instinct[f]) || instinct[f] < 0) errors.push({ field: f, message: 'must be an integer >= 0' }); };
  needStr('id');
  needStr('projectId');
  if (typeof instinct.projectId === 'string' && instinct.projectId && !/^[a-z0-9][a-z0-9-]*$/.test(instinct.projectId)) {
    errors.push({ field: 'projectId', message: 'must match /^[a-z0-9][a-z0-9-]*$/' });
  }
  needStr('action');
  needArr('evidence');
  needArr('examples');
  if (typeof instinct.confidence !== 'number' || instinct.confidence < 0 || instinct.confidence > 1) {
    errors.push({ field: 'confidence', message: 'must be a number in [0, 1]' });
  }
  needInt('firstSeenAt');
  needInt('lastSeenAt');
  needInt('reinforceCount');
  needInt('contradictCount');
  return errors.length ? { valid: false, errors } : { valid: true };
}

/**
 * schema.create({ projectId, action, evidence?, examples?, id?, at? })
 * -> instinct (pure — persistence is done by the store layer).
 * `at` defaults to nextOpSeq(root) when a root is supplied by index.js.
 */
export function create({ projectId, action, evidence = [], examples = [], id }, at = 0) {
  const problems = [];
  if (typeof action !== 'string' || action.trim() === '') problems.push('action');
  if (!Array.isArray(evidence)) problems.push('evidence');
  if (!Array.isArray(examples)) problems.push('examples');
  try { assertProjectId(projectId); } catch { problems.push('projectId'); }
  if (id !== undefined && (typeof id !== 'string' || id.trim() === '')) problems.push('id');
  if (problems.length) {
    throw fail('E_INVALID_INSTINCT', 'invalid instinct fields: ' + problems.join(', '));
  }
  const seq = typeof at === 'number' ? at : 0;
  const instinct = {
    id: id || 'instinct-' + slug(action),
    projectId,
    action,
    evidence: evidence.map((e) => normalizeEvidence(e, seq)),
    examples: [...examples],
    confidence: computeConfidence({ reinforceCount: 0, contradictCount: 0 }),
    firstSeenAt: seq,
    lastSeenAt: seq,
    reinforceCount: 0,
    contradictCount: 0,
  };
  return instinct;
}

export function normalizeEvidence(e, at) {
  if (typeof e === 'string') return { text: e, at };
  if (e && typeof e === 'object') return { ...e, at };
  return { text: String(e), at };
}

export { nextOp };
