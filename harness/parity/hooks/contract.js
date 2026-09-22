/** JEXI OS — Phase 30 Scope A — hook catalog contract. */

export const HOOK_LIFECYCLES = Object.freeze([
  'session',
  'tool',
  'subagent',
  'compaction',
  'permission',
  'worktree',
  'message',
]);

export const HOOK_RETURNS = Object.freeze(['block', 'retry', 'rewrite', 'none']);

export const NOOP_CONTRACT = Object.freeze({ return: 'none' });

export function makeContract(returnType = 'none') {
  return returnType === 'none' ? NOOP_CONTRACT : Object.freeze({ return: returnType });
}

/** Return contract errors without throwing so hooks.validate() is diagnostic. */
export function validateHookSpec(spec, index = -1) {
  const at = index < 0 ? String(spec?.event ?? '(unknown)') : `catalog[${index}]`;
  const errors = [];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return [`${at}: hook spec must be an object`];
  }
  if (typeof spec.event !== 'string' || spec.event === '') errors.push(`${at}: event must be a non-empty string`);
  if (!HOOK_LIFECYCLES.includes(spec.lifecycle)) errors.push(`${at}: lifecycle must be one of ${HOOK_LIFECYCLES.join(', ')}`);
  if (typeof spec.when !== 'string' || spec.when === '') errors.push(`${at}: when must be a non-empty string`);
  if (!(spec.matcher === null || typeof spec.matcher === 'string')) errors.push(`${at}: matcher must be a string or null`);
  if (!Number.isInteger(spec.timeout) || spec.timeout <= 0) errors.push(`${at}: timeout must be a positive integer in milliseconds`);
  if (typeof spec.async !== 'boolean') errors.push(`${at}: async must be boolean`);
  if (!spec.contract || typeof spec.contract !== 'object' || !HOOK_RETURNS.includes(spec.contract.return)) {
    errors.push(`${at}: contract.return must be one of ${HOOK_RETURNS.join(', ')}`);
  }
  if (!Array.isArray(spec.handlers)) errors.push(`${at}: handlers must be an array`);
  if (typeof spec.stub !== 'boolean') errors.push(`${at}: stub must be boolean`);
  if (spec.stub === true && spec.contract?.return !== 'none') errors.push(`${at}: no-op stub contract.return must be none`);
  return errors;
}
