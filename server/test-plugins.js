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
togglePlugin('coding-pipeline');
check('discovered plugin can be enabled', isPluginEnabled('coding-pipeline') === true);
togglePlugin('coding-pipeline');
check('discovered plugin can be disabled', isPluginEnabled('coding-pipeline') === false);
const catalog = listPlugins();
check('every plugin reports live contribution counts', catalog.every((p) => p.live && typeof p.live.agents === 'number'));
check('core is enabled by default', catalog.find((p) => p.id === 'core')?.enabled === true);
check('research pack starts disabled', catalog.find((p) => p.id === 'research-pack')?.enabled === false);

/* ---------------- Toggle + persistence ---------------- */
togglePlugin('research-pack');
check('toggle enables the research pack', isPluginEnabled('research-pack') === true);
togglePlugin('research-pack');
check('toggle disables it again', isPluginEnabled('research-pack') === false);
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
disablePlugin('coding-pack');
check('disabled pack leaves the union', !enabledPluginAgents().has('coder'));
enablePlugin('coding-pack');

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
