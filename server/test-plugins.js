/**
 * Stage 21 (plugin system) tests — all deterministic, isolated DATA_DIR.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-plugin-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');

const { listPlugins, togglePlugin, enablePlugin, disablePlugin, isPluginEnabled, enabledPluginAgents, PLUGINS, ALL_PLUGINS, discoverPlugins } =
  await import('./src/services/PluginRegistry.js');

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; console.log('✅ ' + name); }
  else { failed++; console.log('❌ ' + name); }
}

/* ---------------- Catalog ---------------- */
check('catalog has 6 bundled plugins', PLUGINS.length === 6);

/* ---------------- B50 P5: on-disk plugin packages ---------------- */
const discovered = discoverPlugins();
check('on-disk coding-pipeline plugin discovered', discovered.some((p) => p.id === 'coding-pipeline' && p.builtin === false));
check(`full catalog includes all discovered plugins (${PLUGINS.length + discovered.length} total)`, ALL_PLUGINS.length === PLUGINS.length + discovered.length);
const cp = listPlugins().find((p) => p.id === 'coding-pipeline');
check('coding-pipeline reports 7 packaged skills', cp && cp.live.packagedSkills === 7);
check('coding-pipeline contributes the pipeline skills', cp && cp.contributes.skills.includes('coder') && cp.contributes.skills.includes('security-officer'));
// Lewis's standing spec (Sept 2026): EVERYTHING ships ON — no switches to flip,
// JEXI decides when to use what. Toggles still exist for opting OUT only.
check('discovered plugin ships ON', isPluginEnabled('coding-pipeline') === true);
togglePlugin('coding-pipeline');
check('toggle can turn a plugin off', isPluginEnabled('coding-pipeline') === false);
togglePlugin('coding-pipeline');
check('toggle turns it back on', isPluginEnabled('coding-pipeline') === true);
const catalog = listPlugins();
check('every plugin reports live contribution counts', catalog.every((p) => p.live && typeof p.live.agents === 'number'));
check('core is enabled by default', catalog.find((p) => p.id === 'core')?.enabled === true);
check('EVERY plugin ships enabled (Lewis: default on, no switches)', catalog.every((p) => p.enabled === true));

/* ---------------- Toggle + persistence ---------------- */
togglePlugin('research-pack');
check('toggle turns the research pack off', isPluginEnabled('research-pack') === false);
togglePlugin('research-pack');
check('toggle turns it back on again', isPluginEnabled('research-pack') === true);
enablePlugin('coding-pack');
check('enablePlugin works', isPluginEnabled('coding-pack') === true);

const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'plugins.json'), 'utf-8'));
check('state persists to disk', Array.isArray(saved.enabled) && saved.enabled.includes('coding-pack'));

/* ---------------- Guards ---------------- */
let threw = false;
try { enablePlugin('nope-pack'); } catch (e) { threw = true; }
check('unknown plugin rejected', threw);

threw = false;
try { disablePlugin('core'); } catch (e) { threw = true; }
check('core cannot be disabled', threw);

/* ---------------- Contribution unions ---------------- */
const agents = enabledPluginAgents();
check('core agents are always in the enabled union', agents.has('planner') && agents.has('orchestrator'));
// under the all-on default, 'coder' can come from BOTH coding-pack and the
// on-disk coding-pipeline package — disable every contributor before checking
disablePlugin('coding-pack');
const coderSources = listPlugins().filter((p) => p.enabled && (p.contributes?.skills || []).includes('coder')).map((p) => p.id);
for (const id of coderSources) disablePlugin(id);
check('disabled packs leave the union', !enabledPluginAgents().has('coder'));
for (const id of coderSources) enablePlugin(id);
enablePlugin('coding-pack');

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
