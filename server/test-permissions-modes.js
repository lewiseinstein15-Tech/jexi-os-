/**
 * FINAL F4 — permission modes + doom-loop breaker.
 * Proves: three honest tool profiles (readonly/standard/full) with legacy
 * 'ask' mapping; enforcement blocks before execution; the /api/agent
 * profile override actually reaches the loop; the loop breaker trips at 5
 * identical consecutive calls (and the reminder no longer TDZ-crashes the
 * turn); the Settings UI picker is wired to the profile endpoint.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TOOL_PROFILES, toolPermission, activeToolProfile, setToolProfile, executeTool } from './src/services/ToolRuntime.js';
import { LOOP_BREAKER_LIMIT, loopBreakerTrips, loopBreakerMessage, repeatReminderFor } from './src/services/AgentLoop.js';

const __d = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}`); } };

console.log('\n== 1. Three honest profiles ==');
ok(Object.keys(TOOL_PROFILES).length === 3, 'exactly three profiles exist');
ok(TOOL_PROFILES.readonly && TOOL_PROFILES.readonly.allow.join(',') === 'safe', 'readonly allows safe tools only');
ok(TOOL_PROFILES.auto && TOOL_PROFILES.auto.allow.join(',') === 'safe,medium', 'standard(auto) allows safe+medium');
ok(TOOL_PROFILES.full && TOOL_PROFILES.full.allow.join(',') === 'safe,medium,risky', 'full allows everything');
ok(!TOOL_PROFILES.ask, "retired 'ask' profile is gone (no duplicate mode)");
ok(/read/i.test(TOOL_PROFILES.readonly.label), 'readonly is labelled as read-only');

console.log('\n== 2. Legacy ask mapping (same enforcement, honest name) ==');
const before = (() => { try { return activeToolProfile(); } catch { return 'auto'; } })();
setToolProfile('ask');
ok(activeToolProfile() === 'readonly', "saved 'ask' reads back as readonly");
const r = await executeTool({ slug: 'code-write', args: { path: 'x.js', content: 'x' }, profile: 'readonly' });
ok(r.ok === false && r.blocked === true, 'risky tool blocked under readonly');
ok(/Settings → Tools/.test(r.error || ''), 'block message points at Settings → Tools');
const m = await executeTool({ slug: 'memory-write', args: { key: 'k', value: 'v' }, profile: 'readonly' });
ok(m.ok === false && m.blocked === true, 'medium tool blocked under readonly');
ok(toolPermission('web-search') === 'safe' && TOOL_PROFILES.readonly.allow.includes('safe'), 'reads stay allowed under readonly (perm logic)');
setToolProfile(before === 'readonly' || before === 'ask' ? 'auto' : before);

console.log('\n== 3. Doom-loop breaker ==');
ok(LOOP_BREAKER_LIMIT === 5, 'breaker limit is 5 identical consecutive calls');
ok(loopBreakerTrips(4) === false, '4 identical calls do not trip');
ok(loopBreakerTrips(5) === true && loopBreakerTrips(9) === true, '5+ identical calls trip');
const msg = loopBreakerMessage('web-search', 5);
ok(msg.includes('web-search') && /did NOT execute/i.test(msg), 'breaker message names the tool and states it did not execute');
ok(typeof repeatReminderFor('k', 3) === 'string', '3-call advisory reminder still exists');

console.log('\n== 4. Loop wiring (static) ==');
const loop = fs.readFileSync(path.join(__d, 'src', 'services', 'AgentLoop.js'), 'utf-8');
ok(loop.indexOf('loopBreakerTrips(preCount)') !== -1 && loop.indexOf('loopBreakerTrips(preCount)') < loop.indexOf('await executeTool('), 'breaker is checked BEFORE executeTool runs');
ok(loop.indexOf('let content =') !== -1 && loop.indexOf('let content =') < loop.indexOf('repeatReminderFor(callKey'), 'content declared before the reminder appends (TDZ fix)');
const idx = fs.readFileSync(path.join(__d, 'index.js'), 'utf-8');
ok(/runAgentLoop\(\{\s*query,\s*image,\s*sendEvent,\s*opts:\s*profile/.test(idx), '/api/agent passes profile inside opts');

console.log('\n== 5. Settings picker wiring (static) ==');
const settings = fs.readFileSync(path.join(__d, '..', 'src', 'components', 'SettingsView.jsx'), 'utf-8');
ok(settings.includes('/api/tools/profile') && settings.includes("method: 'POST'"), 'picker POSTs to /api/tools/profile');
ok(settings.includes('Tool permissions') && settings.includes('activeProfile'), 'picker renders profiles + active state from /api/tools');

console.log(`\nF4 permissions-modes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
