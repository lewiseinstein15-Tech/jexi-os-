/**
 * AGI Phase 8 — skills system contracts. Keyless, deterministic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.DATA_DIR = './data/test-agi-skills';

const { validateSkill, listSkills, usableSkills, findSkillsFor, promoteSkill, learnSkillFromLesson, SKILL_STATUSES } = await import('../../src/services/Skills.js');

const GOOD = {
  name: 'test-skill', version: 1, status: 'validated',
  description: 'A well-formed test skill with everything required.',
  requirements: ['nothing special'],
  procedure: ['first do this step properly', 'then do that step properly'],
  tools: ['native:web-search'],
  examples: [],
  failureModes: ['goes wrong when steps are skipped'],
  verification: 'the outcome is checked against the real result',
};

/* ═══ 1. validation is a real gate ══════════════════════════════════════ */

test('a complete skill passes validation; each missing piece is named', () => {
  assert.equal(validateSkill(GOOD).ok, true);
  for (const field of ['name', 'description', 'procedure', 'tools', 'failureModes', 'verification']) {
    const broken = { ...GOOD };
    if (field === 'name') broken.name = 'Bad Name!!';
    else if (field === 'procedure') broken.procedure = ['one step'];
    else broken[field] = undefined;
    const v = validateSkill(broken);
    assert.equal(v.ok, false, `removing ${field} must fail validation`);
    assert.ok(v.problems.length >= 1);
  }
});

test('drafts with vague one-word steps are refused', () => {
  const v = validateSkill({ ...GOOD, procedure: ['do', 'stuff', 'things'] });
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /real sentence/.test(p)));
});

/* ═══ 2. seeded skills load and are usable ══════════════════════════════ */

test('the shipped skills are valid and usable', () => {
  const seeded = listSkills().filter((s) => !s.name.startsWith('learned-'));
  assert.ok(seeded.length >= 2);
  for (const s of seeded) assert.equal(validateSkill(s).ok, true, `${s.name} must validate`);
  assert.ok(usableSkills().some((s) => s.name === 'deploy-then-verify'));
  assert.ok(usableSkills().some((s) => s.name === 'research-with-sources'));
});

test('skill retrieval matches tasks by content, honestly', () => {
  const deploy = findSkillsFor('deploy the service and confirm it is live');
  assert.ok(deploy.some((s) => s.name === 'deploy-then-verify'));
  const research = findSkillsFor('research the topic with real sources');
  assert.ok(research.some((s) => s.name === 'research-with-sources'));
  assert.equal(findSkillsFor('zzz qqq xxx').length, 0); // no match → nothing, never a guess
});

/* ═══ 3. learning: lesson → draft → validate → promote ══════════════════ */

test('a lesson becomes a DRAFT skill that is NOT usable until promoted', () => {
  fs.rmSync(process.env.DATA_DIR + '/skills', { recursive: true, force: true });
  const learned = learnSkillFromLesson({
    kind: 'recovery', missionId: 'mskills', objective: 'deploy api',
    failure: 'deploy exited 0 but health returned 502', cause: 'trusted exit code',
    strategy: 'curl the live health URL after deploy', lesson: 'exit 0 does not mean the site works',
  });
  assert.equal(learned.ok, true);
  assert.equal(learned.skill.status, 'draft');
  // drafts are stored but never usable
  assert.ok(!usableSkills().some((s) => s.name === learned.skill.name));
  // and a lesson without substance is refused
  assert.equal(learnSkillFromLesson({ lesson: 'x' }).ok, false);
});

test('promotion validates, versions, and makes the skill usable', () => {
  const draft = learnSkillFromLesson({
    kind: 'recovery', missionId: 'mskills2', objective: 'deploy web',
    failure: 'site down after deploy', cause: 'no health check',
    strategy: 'request the live URL and expect 200', lesson: 'always verify the live URL after deploying a site',
  });
  const promoted = promoteSkill(draft.skill);
  assert.equal(promoted.ok, true);
  assert.equal(promoted.skill.status, 'validated');
  assert.ok(promoted.skill.version >= 1);
  assert.ok(usableSkills().some((s) => s.name === draft.skill.name));
  // promoting garbage is refused with named problems
  const bad = promoteSkill({ name: 'Bad Name!!' });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.length >= 2);
});

test('re-promotion bumps the version (skills are versioned artifacts)', () => {
  const d1 = learnSkillFromLesson({ kind: 'recovery', missionId: 'v1', lesson: 'verify deploys with real requests', strategy: 'curl health', failure: 'the site returned 502 after deploy', cause: 'exit code trust' });
  const p1 = promoteSkill(d1.skill);
  const p2 = promoteSkill({ ...d1.skill, description: 'refined: verify deployments with a real live request', procedure: ['deploy the service', 'request the live health endpoint', 'treat non-200 as failure'] });
  assert.ok(p2.skill.version > p1.skill.version);
});

test('malformed skill files never crash the system', () => {
  fs.mkdirSync(process.env.DATA_DIR + '/skills', { recursive: true });
  fs.writeFileSync(process.env.DATA_DIR + '/skills/broken.json', '{not json');
  const all = listSkills();
  assert.ok(!all.some((s) => s.origin === 'broken.json'));
  assert.ok(Array.isArray(all));
});
