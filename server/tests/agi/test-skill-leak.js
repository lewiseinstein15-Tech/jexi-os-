/**
 * SCOPE D — part 3 — synthesized skills never leak into the repo tree.
 *
 * loadSkill()'s roster-synthesis fallback USED to persist generated .md files
 * into server/skills/ (the bundled, git-tracked library) — the "debugging.md
 * in git" leak. The machine-generated file must instead land under
 * DATA_DIR/skills (gitignored, the SAME user-dsh root SkillDiscovery watches):
 *   - the repo tree server/skills stays READ-ONLY for the bundled library
 *   - a synthesized skill is re-read (not re-written) on subsequent boots
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-d3-'));

const chain = await import('../../src/services/SkillChain.js');
const { loadSkill, SYNTHESIZED_SKILLS_DIR, SKILLS_DIR } = chain;

test('synthesized fallback writes to DATA_DIR/skills, never server/skills', () => {
  // 'debugging' is a roster-synthesized slug with no bundled folder/file.
  const r = loadSkill('debugging');
  assert.ok(r, 'debugging must synthesize');
  assert.equal(r.synthesized, true);

  // the ONLY place the file may exist is DATA_DIR/skills (gitignored);
  // server/skills (the bundled library) must NOT receive it.
  assert.equal(fs.existsSync(path.join(SKILLS_DIR, 'debugging.md')), false, 'no file in server/skills');
  assert.equal(fs.existsSync(path.join(SYNTHESIZED_SKILLS_DIR, 'debugging.md')), true, 'file exists in DATA_DIR/skills');
});

test('a second load re-reads the persisted synthesized file (idempotent)', () => {
  const before = fs.readFileSync(path.join(SYNTHESIZED_SKILLS_DIR, 'debugging.md'), 'utf-8');
  const r = loadSkill('debugging');
  assert.equal(r.synthesized, true);
  assert.ok(r.md.length > 0);
  assert.equal(fs.readFileSync(path.join(SYNTHESIZED_SKILLS_DIR, 'debugging.md'), 'utf-8'), before);
  assert.equal(fs.existsSync(path.join(SKILLS_DIR, 'debugging.md')), false);
});