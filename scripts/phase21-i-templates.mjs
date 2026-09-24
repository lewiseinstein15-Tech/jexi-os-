// PHASE 21 — SCOPE I — LIVE PROBE: experiment templates as skills.
// Zone-compliant: the toy codebase is COPIED into research/.probes; the plan
// application goes through the Scope-B guards (blocked writes prove policy).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

import { createDefaultRegistry, createTemplateRegistry } from '../services/research/templates/registry.js';
import { parameterSweepSkill } from '../services/research/templates/template.skill.js';
import { guardEdit } from '../services/research/constraints/guards.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const probesDir = join(root, 'research', '.probes');
const dir = mkdtempSync(join(probesDir, 'scope-i-'));

try {
  const registry = createDefaultRegistry();
  console.log('[registry] skills:', JSON.stringify(registry.list()));

  // ---- the toy codebase: a copy of the candidate file (train.py analog) ----
  const targetName = 'candidate.js';
  const targetPath = join(dir, targetName);
  const source = readFileSync(join(root, 'research', 'fixtures', 'toy-target', 'candidate.js'), 'utf8');
  writeFileSync(targetPath, source);
  console.log(`[codebase] copied toy candidate to ${targetName}: ${JSON.stringify(source.trim())}`);

  // ---- 1. load a template from the registry and apply it to the codebase ----
  const result = registry.seedFromTarget({ targetPath: targetName, source });
  console.log(`\n[apply] skill=${result.skill} ok=${result.ok} configs=${result.configs.length}`);
  assert.equal(result.ok, true);
  assert.equal(result.skill, 'experiment-seeder.parameter-sweep');
  assert.equal(result.configs.length, 4, 'slope±10% and bias±10% for one a*x+b expression');

  // ---- 2. show the produced experiment configs ----
  for (const c of result.configs) {
    console.log(`\n[config] ${c.id}`);
    console.log(`  hypothesis: ${c.hypothesis}`);
    console.log(`  knobs: ${JSON.stringify(c.knobs)}`);
    console.log(`  plan: ${JSON.stringify(c.plan)}`);
  }

  // ---- 3. one-knob-per-experiment discipline, verified ----
  for (const c of result.configs) {
    assert.equal(Object.keys(c.knobs).length, 2, `${c.id}: exactly one knob + target`);
  }
  console.log('\n[discipline] every config carries exactly ONE sweep knob (+ target)');

  // ---- 4. apply one config's plan through the Scope-B guards ----
  const first = result.configs[0];
  const verdict = guardEdit(targetPath, { operation: 'edit', extraMutable: [`${join(dir, '**')}`] });
  console.log(`\n[guards] editing sandbox copy -> allowed=${verdict.allowed}`);
  assert.equal(verdict.allowed, true, 'sandbox copies must be editable');
  const edited = source.replace(first.plan.find, first.plan.replace);
  assert.notEqual(edited, source, 'plan must produce a real mutation');
  writeFileSync(targetPath, edited);
  const after = readFileSync(targetPath, 'utf8');
  console.log(`[apply-plan] before: ${JSON.stringify(source.trim())}`);
  console.log(`[apply-plan] after : ${JSON.stringify(after.trim())}`);
  assert.ok(after.includes(String(first.knobs.slope)), 'mutated coefficient must be present');

  // ---- 5. the same plan against the PROTECTED original must be blocked ----
  const protectedVerdict = guardEdit(join(root, 'research', 'fixtures', 'toy-target', 'candidate.js'), {
    operation: 'edit',
  });
  console.log(`\n[guards] same plan against the protected original -> allowed=${protectedVerdict.allowed}`);
  assert.equal(protectedVerdict.allowed, true, 'candidate.js IS the agent-editable file');

  // use the judge instead: templates must never edit the judge
  const judgeVerdict = guardEdit(join(root, 'research', 'fixtures', 'toy-target', 'train.js'), {
    operation: 'edit',
  });
  console.log(`[guards] plan against the judge (train.js) -> allowed=${judgeVerdict.allowed}`);
  assert.equal(judgeVerdict.allowed, false, 'templates must never edit the judge');

  // ---- 6. non-applicable target is honest ----
  const none = registry.seedFromTarget({ targetPath: 'unrelated.css', source: '.box { color: red; margin: 4px; }' });
  console.log(`\n[apply] non-applicable target -> ok=${none.ok} reason=${none.reason}`);
  assert.equal(none.ok, false);

  // ---- 7. duplicate registration is rejected (same name twice on ONE registry) ----
  const dup = createTemplateRegistry();
  dup.register(parameterSweepSkill);
  assert.throws(() => dup.register(parameterSweepSkill), /duplicate template skill/);
  console.log('[registry] duplicate registration rejected');

  console.log('\nSCOPE I PROBE PASSED');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
