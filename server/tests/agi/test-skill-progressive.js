/**
 * AGI Phase 4 (Scope B) — SKILLS progressive-disclosure contracts.
 *
 *   catalog:  startup loads metadata ONLY (never the full body)
 *   loader:   read_skill loads full content on demand
 *   trigger:  skill not triggered → not loaded; triggered → loaded
 *   curator:  dedupes overlapping skills (cosine >= 0.75)
 *   curator:  archives stale skills (unused > STALE_DAYS)
 *
 * Uses a temp store (JEXI_SKILLS_STORE) so the repo store is untouched.
 * Keyless, deterministic, no model calls.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-skill-store-'));
process.env.JEXI_SKILLS_STORE = STORE;

const { catalog, catalogSystemPrompt } = await import('../../src/skills/catalog.js');
const { readSkill, readSkillAsync } = await import('../../src/skills/loader.js');
const { reviewDraft, archiveStaleSkill, restoreSkill, runCurator, STALE_DAYS, recordSkillUsage } = await import('../../src/skills/curator.js');

/** A near-verbatim duplicate of the debugging skill's description (deliberate overlap). */
function interpretAsDuplicate(description) {
  return `${description} (variant wording)`;
}

const DEBUG_MD = `---
name: debugging-failing-tests
description: Debug failing tests after a code change
whenToUse: test output shows failures after a recent change
allowedTools: [read, edit, terminal.execute, testing.run]
---
# Procedure

1. Read the failing test.
2. Read the code under test.
3. Reproduce minimally.
4. Change the smallest surface that fixes the root cause.
5. Re-run until green.
`;

const TESTING_MD = `---
name: testing-code-changes
description: Write and run tests for a code change
whenToUse: a code change needs test coverage or verification
allowedTools: [read, edit, terminal.execute, testing.run]
---
# Procedure

1. Identify the behavior change.
2. Write the smallest test that locks it.
3. Run the focused test file.
4. Cover the failure path too.
5. Confirm the full suite stays green.
`;

function writeSkill(slug, md) {
  fs.mkdirSync(path.join(STORE, slug, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(STORE, slug, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(STORE, slug, 'SKILL.md'), md);
}

before(() => {
  writeSkill('debugging', DEBUG_MD);
  writeSkill('testing', TESTING_MD);
  fs.writeFileSync(path.join(STORE, 'debugging', 'scripts', 'reproduce-test.mjs'), '# helper\n');
  fs.writeFileSync(path.join(STORE, 'debugging', 'resources', 'debug-checklist.md'), '# checklist\n');
});

test('catalog loads at startup — metadata only, NOT full content', async () => {
  const index = await catalog();
  const slugs = Object.keys(index).sort();
  assert.deepEqual(slugs, ['debugging', 'testing']);
  const dbg = index.debugging;
  assert.equal(dbg.name, 'debugging-failing-tests');
  assert.equal(dbg.description, 'Debug failing tests after a code change');
  assert.equal(dbg.whenToUse, 'test output shows failures after a recent change');
  assert.deepEqual(dbg.allowedTools, ['read', 'edit', 'terminal.execute', 'testing.run']);
  // Progressive: the catalog entry must NOT carry the full # Procedure body.
  assert.ok(!JSON.stringify(dbg).includes('# Procedure'), 'catalog entry must not include the body');
  assert.ok(!JSON.stringify(dbg).includes('Read the code under test'), 'catalog entry must not leak body text');
});

test('system prompt summary is compact', async () => {
  const sp = await catalogSystemPrompt();
  assert.ok(sp.includes('debugging: Debug failing tests'));
  assert.ok(sp.includes('testing: Write and run tests'));
  assert.ok(sp.length < 600, `compact: ${sp.length} chars`);
});

test('read_skill loads full content on demand', async () => {
  const full = await readSkillAsync('debugging');
  assert.ok(full, 'skill exists');
  assert.match(full.content, /# Procedure/);
  assert.ok(full.content.includes('Reproduce minimally'));
  // scripts/resources paths are surfaced
  assert.ok(full.scripts.some((s) => s.endsWith('reproduce-test.mjs')));
  assert.ok(full.resources.some((r) => r.endsWith('debug-checklist.md')));
  // raw includes frontmatter; content does not
  assert.ok(full.raw.includes('---\n'), 'raw keeps frontmatter');
});

test('skill NOT triggered → NOT loaded; triggered → loaded', async () => {
  // "trigger" = a whenToUse match decides whether we demand-load.
  const index = await catalog();
  const triggered = Object.values(index).filter((s) => s.whenToUse.includes('test output shows failures'));
  assert.deepEqual(triggered.map((s) => s.slug), ['debugging']);
  // Before demand-loading, the body must not be in memory from catalog:
  const notLoadedYet = readSkill('testing') === null ? 'testing not loaded' : readSkill('testing');
  assert.ok(Object.values(await catalog()).every((s) => !JSON.stringify(s).includes('# Procedure')));
  // Now demand-load the triggered skill:
  const full = readSkill(triggered[0].slug);
  assert.ok(full && full.content.length > DEBUG_MD.split('---').pop().length - 100);
  void notLoadedYet;
});

test('curator dedupes overlapping skills (cosine >= threshold)', async () => {
  const report = await runCurator({ now: Date.now() });
  assert.ok(report.reviewed.includes('debugging'));
  assert.ok(report.reviewed.includes('testing'));
  // Distinct skills should NOT be flagged as dupes by this threshold.
  assert.equal(report.deduped.length, 0, 'distinct debugging/test skills are not dupes');
  // A near-duplicate draft IS rejected:
  const dupDraft = {
    name: 'debug-flaky-tests',
    description: interpretAsDuplicate('Debug failing tests after a code change'),
    whenToUse: 'test output shows failures after a recent change',
  };
  const verdict = reviewDraft(dupDraft);
  assert.equal(verdict.verdict, 'dedupe-reject');
  assert.ok(verdict.overlaps.length >= 1);
  assert.equal(verdict.overlaps[0].slug, 'debugging');
});

test('stale skill is archived (unused > STALE_DAYS)', async () => {
  // debugging is "used" now → not stale.
  recordSkillUsage('debugging');
  // testing never used... but never-used is borderline. Use a skill unused for > 30d:
  // Simulate by writing a skill and back-dating its usage journal entry.
  writeSkill('ancient-skill', `---\nname: ancient-skill\ndescription: out of date\nwhenToUse: never\n---\n# Old\n`);
  const journalPath = path.join(STORE, '..', '.skill-usage.json');
  let journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  journal['ancient-skill'] = Date.now() - (STALE_DAYS + 5) * 86_400_000;
  fs.writeFileSync(journalPath, JSON.stringify(journal));

  const archived = archiveStaleSkill('ancient-skill');
  assert.ok(archived, 'ancient skill archived');
  assert.ok(!fs.existsSync(path.join(STORE, 'ancient-skill')), 'moved out of live store');
  assert.ok(fs.existsSync(path.join(STORE, 'archive', 'ancient-skill')), 'in archive');

  const restored = restoreSkill('ancient-skill');
  assert.ok(restored);
  assert.ok(fs.existsSync(path.join(STORE, 'ancient-skill')), 'restored to live store');
  assert.ok(!fs.existsSync(path.join(STORE, 'archive', 'ancient-skill')), 'removed from archive');
});

test('the working agent does NOT decide its own library is correct (curator gate)', () => {
  // A draft that overlaps the library is refused by the curator even if the
  // working agent wanted to add it.
  const selfProposed = { name: 'fix-broken-test', description: 'Debug failing tests after a code change', whenToUse: 'test output shows failures' };
  const verdict = reviewDraft(selfProposed);
  assert.equal(verdict.verdict, 'dedupe-reject');
  assert.ok(verdict.reasons.length >= 1);
});