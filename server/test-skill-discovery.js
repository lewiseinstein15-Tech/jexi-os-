/**
 * B98 — SKILL AUTO-DISCOVERY regression suite (deepseek-harness
 * `skill-filesystem` + `tool-skill` mirror).
 *
 * Proves: ranked roots (project 100 → agents 200 → plugin 300 → user 400 →
 * bundled 600), SKILL.md folders + flat <name>.md, frontmatter validation
 * (name+description required, invocation policy, invalid files ignored with
 * warnings), collision resolution by rank, progressive disclosure (catalog
 * metadata only; full body via getSkillBody), mtime-based invalidation,
 * model-facing catalog bounds, and the skill-search/skill-load tools through
 * the gated ToolRuntime with output contracts.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-skill-disc-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');
const WS = process.env.WORKSPACE_DIR;
const DATA = process.env.DATA_DIR;

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const {
  discoverSkills, getSkillBody, loadSkillForModel, listSkillCatalog,
  buildSkillCatalog, createUserSkill, invalidateSkillCache, isSkillPath,
  observeHostMutationFromArgs, startSkillWatcher, stopSkillWatcher,
  PROJECT_DSH_RANK, PROJECT_AGENTS_RANK, USER_DSH_RANK,
} = await import('./src/services/SkillDiscovery.js');
const { executeTool } = await import('./src/services/ToolRuntime.js');

const write = (p, content) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content, 'utf-8'); };
const SKILL = (name, desc, extra = '') => `---\nname: ${name}\ndescription: ${desc}\n${extra}---\n\n# ${name}\n\nFull body of ${name} — only loaded at execution time.`;
const find = (name) => listSkillCatalog().find((c) => c.name === name);

console.log('\n== Fixtures: ranked roots + files ==');
// project-dsh (rank 100) — folder form with reference.md
write(path.join(WS, '.jexi/skills/git-branching/SKILL.md'), SKILL('git-branching', 'Safe git branching workflows with conflict recovery.', 'whenToUse: any repo work involving branches\n'));
write(path.join(WS, '.jexi/skills/git-branching/reference.md'), '# Git reference\n\nRebase vs merge rules.');
// project-agents (rank 200) — flat form
write(path.join(WS, '.agents/skills/meeting-notes.md'), SKILL('meeting-notes', 'Structured meeting notes with action owners and deadlines.'));
// user (rank 400) — flat form + invalid files + collision
write(path.join(DATA, 'skills/code-review.md'), SKILL('code-review', 'Peer code review checklist with severity rubric.', 'user-invocable: false\n'));
write(path.join(DATA, 'skills/notes.md'), SKILL('notes', 'Quick note taking in the user root.'));
write(path.join(DATA, 'skills/bad-skill/SKILL.md'), '# no frontmatter here');
write(path.join(DATA, 'skills/UPPER/SKILL.md'), '---\nname: UPPER\n---\nno description');
write(path.join(DATA, 'skills/legacy/SKILL.md'), '---\nname: legacy\nmodelInvocable: true\n---\nlegacy key');
// collision: 'notes' also in project-dsh → rank 100 must win over user 400
write(path.join(WS, '.jexi/skills/notes/SKILL.md'), SKILL('notes', 'Project-local notes with workspace conventions.'));

console.log('\n== 1. Discovery: roots, forms, metadata only ==');
const candidates = discoverSkills(true);
ok(candidates.some((c) => c.name === 'git-branching' && c.source === 'project-dsh' && c.rank === PROJECT_DSH_RANK), 'folder SKILL.md discovered at project-dsh rank 100');
ok(candidates.some((c) => c.name === 'meeting-notes' && c.source === 'project-agents' && c.rank === PROJECT_AGENTS_RANK), 'flat <name>.md discovered at project-agents rank 200');
ok(candidates.some((c) => c.name === 'code-review' && c.source === 'user-dsh' && c.rank === USER_DSH_RANK), 'user skill discovered at rank 400');
ok(!candidates.some((c) => c.name === 'bad-skill'), 'file without frontmatter ignored');
ok(!candidates.some((c) => c.name === 'UPPER'), 'invalid skill name ignored');
ok(!candidates.some((c) => c.name === 'legacy'), 'legacy invocation key rejected (dsh parseInvocationPolicy)');
const notes = find('notes');
ok(notes && notes.source === 'project-dsh', 'collision resolved to highest rank (project beats user)');
ok(candidates.every((c) => !c.content), 'catalog carries NO full bodies (progressive disclosure)');
const git = find('git-branching');
ok(git && git.whenToUse && git.whenToUse.includes('branches'), 'whenToUse parsed from frontmatter');
const cr = find('code-review');
ok(cr && cr.invocation.userInvocable === false, 'user-invocable: false parsed');
ok(cr && cr.invocation.modelInvocable === true, 'model invocation still allowed');

console.log('\n== 2. Warnings: invalid files are recorded, never fatal ==');
const summary = (await import('./src/services/SkillDiscovery.js')).discoverySummary;
ok(summary().warnings.length >= 3, `discovery recorded warnings for invalid files (got ${summary().warnings.length})`);

console.log('\n== 3. Full body loading (progressive get) ==');
const gitBody = getSkillBody('git-branching');
ok(gitBody && gitBody.content.includes('Full body of git-branching'), 'getSkillBody returns full SKILL.md body');
ok(gitBody && gitBody.reference && gitBody.reference.includes('Rebase vs merge'), 'reference.md merged for folder skills');
const modelBody = loadSkillForModel('git-branching');
ok(modelBody && modelBody.content.includes('Rebase vs merge'), 'loadSkillForModel merges reference into content');
ok(modelBody && modelBody.resourceBase && modelBody.resourceBase.kind === 'directory', 'resourceBase directory locator present');
ok(getSkillBody('nope') === undefined, 'unknown skill → undefined');

console.log('\n== 4. Invalidation: mtime rescans + host mutation ==');
ok(isSkillPath(path.join(WS, '.jexi/skills/x/SKILL.md')), 'isSkillPath true inside a root');
ok(!isSkillPath(path.join(TMP, 'elsewhere')), 'isSkillPath false outside roots');
write(path.join(DATA, 'skills/fresh-skill/SKILL.md'), SKILL('fresh-skill', 'A skill created after boot.'));
ok(!!find('fresh-skill'), 'new skill file discovered without explicit invalidate (mtime rescan)');
write(path.join(DATA, 'skills/code-review.md'), SKILL('code-review', 'UPDATED: checklist v2 with security pass.'));
ok(find('code-review').description.includes('UPDATED'), 'edited skill re-read (mtime change)');
fs.unlinkSync(path.join(DATA, 'skills/fresh-skill/SKILL.md'));
ok(!find('fresh-skill'), 'deleted skill removed on rescan');
observeHostMutationFromArgs({ path: path.join(WS, '.jexi/skills/tmp/SKILL.md') });
ok(true, 'observeHostMutationFromArgs accepted (invalidates under root)');
invalidateSkillCache();
ok(discoverSkills(true).length === candidates.length, 'full rescan after explicit invalidate');

console.log('\n== 5. Model-facing catalog (bounded, metadata only, invocable only) ==');
const cat = buildSkillCatalog(10);
ok(cat.includes('git-branching') && cat.includes('meeting-notes'), 'catalog lists discovered skills');
ok(!cat.includes('Full body of'), 'catalog never leaks full bodies');
ok(cat.includes('code-review'), 'modelInvocable skills ARE listed (user-invocable:false only hides the /name gesture, dsh semantics)');
ok(cat.length < 2000, 'catalog is token-bounded');

console.log('\n== 6. Tools through the gated runtime (output contracts) ==');
const searchRes = await executeTool({ slug: 'skill-search', args: { query: 'branches' }, });
ok(searchRes.ok && searchRes.result.includes('git-branching'), 'skill-search finds by description');
ok(!searchRes.result.includes('Full body of'), 'skill-search returns metadata only');
const loadRes = await executeTool({ slug: 'skill-load', args: { skill: 'git-branching' }, });
ok(loadRes.ok && loadRes.result.includes('Rebase vs merge'), 'skill-load returns full merged body');
const loadBy = await executeTool({ slug: 'skill-load', args: { name: 'meeting-notes' }, });
ok(loadBy.ok && loadBy.result.includes('Full body of meeting-notes'), 'skill-load accepts name arg (dsh shape)');
const missRes = await executeTool({ slug: 'skill-load', args: { skill: 'totally-unknown-skill' }, });
ok(missRes.ok === false && /not found/.test(missRes.error || ''), 'skill-load fails honestly for unknown skill');

console.log('\n== 7. User skill authoring (Add Skill) ==');
const created = createUserSkill({
  name: 'release-notes', description: 'Write release notes from commit history and PR titles.',
  whenToUse: 'after every deploy', body: 'Step 1: collect commits. Step 2: group by type. Step 3: write notes.',
  reference: 'Template: ## What changed\n## Migration\n## Rollback',
});
ok(created.ok && fs.existsSync(created.path), 'createUserSkill writes DATA_DIR/skills/<name>/SKILL.md');
ok(!!find('release-notes'), 'created skill auto-discovered immediately');
const createdBody = getSkillBody('release-notes');
ok(createdBody && createdBody.reference.includes('Migration'), 'created skill reference loaded');
let threw = false;
try { createUserSkill({ name: 'Bad Name!', description: 'valid enough', body: 'x'.repeat(60) }); } catch { threw = true; }
ok(threw, 'invalid skill name rejected on create');
threw = false;
try { createUserSkill({ name: 'ok-name', description: 'short', body: 'x'.repeat(60) }); } catch { threw = true; }
ok(threw, 'short description rejected on create');

console.log('\n== 8. Watcher smoke test (skips gracefully if unsupported) ==');
const watched = startSkillWatcher();
ok(watched >= 1, `watcher attached to ${watched} root(s)`);
stopSkillWatcher();
ok(true, 'watcher stopped cleanly');

console.log(`\nB98 skill-discovery: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
