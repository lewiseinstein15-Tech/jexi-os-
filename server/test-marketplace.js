/**
 * B107 — SKILLS MARKETPLACE regression suite.
 *
 * Proves: the curated catalog is valid (kebab names, real descriptions,
 * substantial bodies), install writes to the user root and is instantly
 * auto-discovered + loadable via skill-load, re-install is idempotent,
 * uninstall removes it, unknown names and unsafe paths fail honestly, and
 * the tool registry is untouched.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-mkt-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { MARKETPLACE_SKILLS, listMarketplace, marketplaceStats, installSkill, uninstallSkill, validateMarketplace } = await import('./src/services/SkillMarketplace.js');
const { discoverSkills, loadSkillForModel } = await import('./src/services/SkillDiscovery.js');
const { executeTool } = await import('./src/services/ToolRuntime.js');
const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');

const USER_SKILLS = path.join(process.env.DATA_DIR, 'skills');

console.log('\n== 1. Catalog validity ==');
const v = validateMarketplace();
ok(v.valid === true, `every catalog skill validates (bad: ${v.bad.join(', ') || 'none'})`);
ok(MARKETPLACE_SKILLS.length >= 8, `catalog is curated (${MARKETPLACE_SKILLS.length} skills)`);
ok(new Set(MARKETPLACE_SKILLS.map((s) => s.name)).size === MARKETPLACE_SKILLS.length, 'no duplicate names');
for (const sk of MARKETPLACE_SKILLS) {
  ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(sk.name), `kebab-case name: ${sk.name}`);
}

console.log('\n== 2. Listing + stats ==');
const list = listMarketplace();
ok(list.length === MARKETPLACE_SKILLS.length, 'list covers the catalog');
ok(list.every((s) => s.installed === false), 'nothing installed initially');
ok(list.every((s) => s.description && s.whenToUse && Array.isArray(s.tags)), 'entries carry description/whenToUse/tags');
const st = marketplaceStats();
ok(st.total === MARKETPLACE_SKILLS.length && st.installed === 0, 'stats correct');

console.log('\n== 3. Install → auto-discovered → usable in chat ==');
const r = installSkill('meeting-notes');
ok(r.ok === true && r.installed === true, 'install succeeds');
ok(fs.existsSync(path.join(USER_SKILLS, 'meeting-notes', 'SKILL.md')), 'SKILL.md written to the user root');
ok(fs.existsSync(path.join(USER_SKILLS, 'meeting-notes', 'reference.md')), 'reference.md written');
const found = discoverSkills().find((c) => c.name === 'meeting-notes');
ok(!!found && found.source === 'user-dsh' && found.rank === 400, 'installed skill auto-discovered at rank 400');
const body = loadSkillForModel('meeting-notes');
ok(!!body && body.content.includes('Meeting Notes Skill'), 'full body loads (progressive)');
ok(body.reference === undefined, 'loadSkillForModel merges reference into content');
ok(String(body.content).includes('## Template'), 'reference merged into the model body');
const tool = await executeTool({ slug: 'skill-load', args: { skill: 'meeting-notes' } });
ok(tool.ok === true && /Meeting Notes Skill/.test(String(tool.result || '')), 'skill-load tool loads the marketplace skill through the gate');
ok(marketplaceStats().installed === 1, 'stats reflect the install');

console.log('\n== 4. Idempotence + errors + uninstall ==');
const r2 = installSkill('meeting-notes');
ok(r2.ok === true, 're-install is idempotent');
ok(installSkill('not-a-real-skill').ok === false, 'unknown skill fails honestly');
ok(uninstallSkill('../../etc').ok === false, 'path traversal uninstall refused');
ok(uninstallSkill('not-installed').ok === false, 'uninstalling a non-installed skill fails honestly');
const u = uninstallSkill('meeting-notes');
ok(u.ok === true && u.installed === false, 'uninstall succeeds');
ok(!fs.existsSync(path.join(USER_SKILLS, 'meeting-notes')), 'folder removed');
ok(!discoverSkills().some((c) => c.name === 'meeting-notes'), 'discovery drops the uninstalled skill');
ok(marketplaceStats().installed === 0, 'stats reflect the uninstall');

console.log('\n== 5. Other catalog entries install cleanly ==');
for (const sk of MARKETPLACE_SKILLS.slice(0, 4)) {
  const ir = installSkill(sk.name);
  ok(ir.ok === true, `install ${sk.name}`);
}
ok(marketplaceStats().installed === 4, 'four skills installed');
const loaded = loadSkillForModel('code-review');
ok(!!loaded && /Code Review Skill/.test(String(loaded.content || '')), 'code-review loads with body');

console.log('\n== 6. Registry untouched ==');
ok(TOOL_COUNT === 191, `registry count unchanged (${TOOL_COUNT})`);

console.log(`\nB107 marketplace: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
