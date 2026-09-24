/**
 * JEXI OS — Phase 26 Scope B — confidence scoring model.
 *
 * DECLARED FORMULA (computed, never fabricated):
 *
 *   score = clamp( BASE
 *                + (reinforceCount * REINFORCE_STEP)
 *                - (contradictCount * CONTRADICT_STEP),
 *                0, 1 )
 *
 *   BASE             = 0.3
 *   REINFORCE_STEP   = 0.1   (per corroborating evidence)
 *   CONTRADICT_STEP  = 0.2   (per contradicting evidence)
 *
 * Result is rounded to 4 decimals deterministically
 * (Math.round(x * 10000) / 10000) to kill float noise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../../../services/semantica/_internal.js';
import { projectDir } from '../observe/scope.js';
import { nextOp } from '../observe/queue.js';
import { normalizeEvidence } from './schema.js';

export const MODEL = {
  base: 0.3,
  reinforceStep: 0.1,
  contradictStep: 0.2,
  min: 0,
  max: 1,
};

const round4 = (x) => Math.round(x * 10000) / 10000;
const clamp = (x) => Math.min(MODEL.max, Math.max(MODEL.min, x));

export function computeConfidence({ reinforceCount, contradictCount }) {
  return round4(clamp(MODEL.base + reinforceCount * MODEL.reinforceStep - contradictCount * MODEL.contradictStep));
}

/** confidence.score(instinct) -> { score, signals } with full derivation. */
export function score(instinct) {
  if (!instinct || typeof instinct !== 'object') {
    throw fail('E_INVALID_INSTINCT', 'score requires an instinct object');
  }
  const reinforceContribution = round4((instinct.reinforceCount || 0) * MODEL.reinforceStep);
  const contradictContribution = round4((instinct.contradictCount || 0) * MODEL.contradictStep);
  const raw = round4(MODEL.base + reinforceContribution - contradictContribution);
  return {
    score: computeConfidence({ reinforceCount: instinct.reinforceCount || 0, contradictCount: instinct.contradictCount || 0 }),
    signals: {
      base: MODEL.base,
      reinforceCount: instinct.reinforceCount || 0,
      contradictCount: instinct.contradictCount || 0,
      reinforceContribution,
      contradictContribution,
      raw,
      clamped: raw < MODEL.min || raw > MODEL.max,
      formula: 'clamp(' + MODEL.base + ' + reinforceCount*' + MODEL.reinforceStep + ' - contradictCount*' + MODEL.contradictStep + ', 0, 1), rounded 4dp',
    },
  };
}

const instinctFile = (root, projectId, id) => path.join(projectDir(root, projectId), 'instincts', id + '.json');

export function loadInstinct(root, projectId, instinctId) {
  const f = instinctFile(root, projectId, instinctId);
  if (!fs.existsSync(f)) {
    throw fail('E_UNKNOWN_INSTINCT', 'unknown instinctId in project ' + JSON.stringify(projectId) + ': ' + JSON.stringify(instinctId));
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function saveInstinct(root, projectId, instinct) {
  const dir = path.join(projectDir(root, projectId), 'instincts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(instinctFile(root, projectId, instinct.id), JSON.stringify(instinct, null, 2) + '\n');
  return instinct;
}

/** Shared reinforce/contradict engine (direction: +reinforce | +contradict). */
function update(root, instinctId, { evidence, projectId }, direction) {
  const instinct = loadInstinct(root, projectId, instinctId);
  const at = nextOp(root);
  if (evidence === undefined) {
    throw fail('E_INVALID_EVIDENCE', direction + ' requires { evidence }');
  }
  instinct.evidence.push(normalizeEvidence(evidence, at));
  if (direction === 'reinforce') instinct.reinforceCount += 1;
  else instinct.contradictCount += 1;
  instinct.lastSeenAt = at;
  instinct.confidence = computeConfidence(instinct);
  saveInstinct(root, projectId, instinct);
  return { ...instinct };
}

export const reinforce = (root, instinctId, spec) => update(root, instinctId, spec, 'reinforce');
export const contradict = (root, instinctId, spec) => update(root, instinctId, spec, 'contradict');
