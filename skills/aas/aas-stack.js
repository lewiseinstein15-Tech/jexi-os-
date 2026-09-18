/**
 * JEXI OS — AAS CORE — aas-stack.js
 *
 * Persists a VALIDATED stack (output of compose-stack.compose) to disk and
 * loads it back. Refuses to save an unvalidated stack — a stack file is by
 * definition a compose()-approved artifact.
 *
 * Default sink: skills/aas/aas-stack.json (gitignored — it is a runtime
 * artifact, not source). Override with { path } or JEXI_AAS_STACK.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STACK_PATH = process.env.JEXI_AAS_STACK || path.join(HERE, 'aas-stack.json');

export function saveStack(stack, { path: out = DEFAULT_STACK_PATH } = {}) {
  const shapeOk = stack
    && Array.isArray(stack.ids) && stack.ids.length > 0
    && Array.isArray(stack.skills) && stack.skills.length === stack.ids.length
    && stack.skills.every((s) => s && typeof s.id === 'string' && typeof s.description === 'string')
    && typeof stack.totalDescriptionChars === 'number' && typeof stack.budget === 'number';
  if (!shapeOk) {
    throw new TypeError('saveStack: refuses to persist — pass the VALIDATED stack object (compose().stack with ids/skills/budget), not raw ids.');
  }
  const payload = {
    kind: 'jexi.aas.stack',
    version: 1,
    savedAt: new Date().toISOString(),
    ids: stack.ids,
    skills: stack.skills,
    totalDescriptionChars: stack.totalDescriptionChars,
    budget: stack.budget,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');
  return { path: out, bytes: fs.statSync(out).size, ids: payload.ids };
}

export function loadStack({ path: from = DEFAULT_STACK_PATH } = {}) {
  const raw = fs.readFileSync(from, 'utf8');
  const parsed = JSON.parse(raw);
  if (parsed.kind !== 'jexi.aas.stack') throw new TypeError(`loadStack: ${from} is not a jexi.aas.stack artifact`);
  return parsed;
}

export function stackExists({ path: p = DEFAULT_STACK_PATH } = {}) {
  return fs.existsSync(p);
}
