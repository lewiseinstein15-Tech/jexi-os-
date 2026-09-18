/**
 * JEXI OS — AAS CORE — plan.js
 *
 * IMMUTABLE plan over a validated stack: the plan hash is computed over the
 * CANONICAL form of (selection + createdAt). Any later mutation of the
 * stack breaks verify() — that is the point. Plans are frozen objects;
 * the recorded stack inside them is deep-frozen too.
 *
 * Export: { create(stack), verify(plan) }
 */
import { createHash } from 'node:crypto';

export function canonicalize(stack) {
  return JSON.stringify(
    {
      ids: [...stack.ids].sort(),
      skills: [...stack.skills]
        .map(({ id, name, description, path }) => ({ id, name, description, path }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      totalDescriptionChars: stack.totalDescriptionChars,
      budget: stack.budget,
    },
    Object.keys({}).length ? undefined : ['ids', 'skills', 'totalDescriptionChars', 'budget', 'id', 'name', 'description', 'path'],
    0,
  );
}

export function hashStack(stack, createdAt) {
  return createHash('sha256').update(canonicalize(stack) + '|' + createdAt).digest('hex');
}

export function create(stack) {
  if (!stack || !Array.isArray(stack.ids) || !Array.isArray(stack.skills)) {
    throw new TypeError('plan.create: expects a validated stack (compose().stack)');
  }
  const createdAt = new Date().toISOString();
  const hash = hashStack(stack, createdAt);
  const plan = {
    kind: 'jexi.aas.plan',
    version: 1,
    id: `plan-${hash.slice(0, 12)}`,
    hash,
    createdAt,
    stack: deepFreeze(JSON.parse(JSON.stringify(stack))),
    status: 'created', // lifecycle: created → reviewed → installed (workbench human gate)
  };
  return deepFreeze(plan);
}

export function verify(plan) {
  try {
    if (!plan || plan.kind !== 'jexi.aas.plan' || typeof plan.createdAt !== 'string') return false;
    return hashStack(plan.stack, plan.createdAt) === plan.hash;
  } catch {
    return false;
  }
}

function deepFreeze(o) {
  if (o && typeof o === 'object') for (const k of Object.keys(o)) deepFreeze(o[k]);
  return Object.freeze(o);
}
