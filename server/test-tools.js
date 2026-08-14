/**
 * Stage 9 (unified tool runtime) + Stage 12 (tool-calling loop) tests.
 * Everything here is deterministic and needs no API keys:
 *   - catalog / schema / permission classification
 *   - profile gating (blocked vs allowed)
 *   - argument validation
 *   - real engine calls that need no keys (memory-write, profile-read)
 *   - tool-call extraction (the loop's JSON convention)
 */
import { getToolCatalog, TOOL_PROFILES, toolPermission, activeToolProfile, setToolProfile, executeTool } from './src/services/ToolRuntime.js';
import { extractToolCalls } from './src/services/AgentLoop.js';
import { getTool, TOOL_COUNT } from './src/services/ToolRegistry.js';

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; console.log('✅ ' + name); }
  else { failed++; console.log('❌ ' + name); }
}

/* ---------------- Stage 9: catalog + schemas + permissions ---------------- */
const catalog = getToolCatalog();
check(`catalog exposes all ${TOOL_COUNT} tools`, catalog.length === TOOL_COUNT);
check('every catalog entry has slug + name + desc', catalog.every((t) => t.slug && t.name && t.desc));
check('every catalog entry has a permission level', catalog.every((t) => ['safe', 'medium', 'risky'].includes(t.permission)));
check('executable tools carry schemas', catalog.filter((t) => t.executable).every((t) => t.schema !== null));
check('web-search is safe', toolPermission('web-search') === 'safe');
check('memory-write is medium', toolPermission('memory-write') === 'medium');
check('code-run is risky', toolPermission('code-run') === 'risky');
check('github-cli is risky', toolPermission('github-cli') === 'risky');
check('memory-recall is safe', toolPermission('memory-recall') === 'safe');

/* ---------------- Profiles ---------------- */
check('three profiles exist', Object.keys(TOOL_PROFILES).length === 3);
check('default profile is auto', ['auto', 'ask', 'full'].includes(activeToolProfile()));
setToolProfile('auto');
check('profile can be set', activeToolProfile() === 'auto');
setToolProfile('full');
check('full profile allowed', activeToolProfile() === 'full');
setToolProfile('auto'); // restore

/* ---------------- Argument validation ---------------- */
const missing = await executeTool({ slug: 'web-search', args: {} });
check('missing required arg is rejected', !missing.ok && /missing required arg/.test(missing.error || ''));

const unknown = await executeTool({ slug: 'no-such-tool' });
check('unknown tool is rejected', !unknown.ok);

/* ---------------- Permission gating ---------------- */
const blocked = await executeTool({ slug: 'code-run', args: { command: 'echo hi' }, profile: 'auto' });
check('risky tool blocked under auto profile', blocked.blocked === true && /permission/.test(blocked.error || ''));

const allowed = await executeTool({ slug: 'memory-recall', args: { query: 'quantum' }, profile: 'auto' });
check('safe tool runs under auto profile', allowed.ok === true && typeof allowed.result === 'string');

/* ---------------- Real keyless engines ---------------- */
const written = await executeTool({ slug: 'memory-write', args: { fact: 'tool-runtime test fact', label: 'test' }, profile: 'auto' });
check('memory-write stores a fact', written.ok === true);

const profile = await executeTool({ slug: 'profile-read', args: {}, profile: 'auto' });
check('profile-read returns profile data', profile.ok === true && typeof profile.result === 'string');

const routed = await executeTool({ slug: 'pitch-deck', args: {}, profile: 'auto' });
check('non-executable tool routes to its agents', routed.ok === true && routed.routed === true);

/* ---------------- Stage 12: tool-call extraction ---------------- */
const fenced = extractToolCalls('First I will search.\n```json\n{"tool": "web-search", "args": {"query": "JEXI"}}\n```\nThen answer.');
check('extracts fenced json tool calls', fenced.length === 1 && fenced[0].tool === 'web-search');

const inline = extractToolCalls('{"tool":"memory-recall","args":{"query":"preferences"}}');
check('extracts inline tool calls', inline.length === 1 && inline[0].tool === 'memory-recall');

const mixed = extractToolCalls('no tools needed — here is the answer');
check('no calls when model answers directly', mixed.length === 0);

const deduped = extractToolCalls('```json\n{"tool":"web-search","args":{"query":"x"}}\n```\n```json\n{"tool":"web-search","args":{"query":"x"}}\n```');
check('duplicate calls are deduped', deduped.length === 1);

/* ---------------- Registry sanity (used by the loop) ---------------- */
check('getTool finds web-search', getTool('web-search')?.name === 'Web Search');
check('registry count is 176', TOOL_COUNT === 176); // +1: mcp-call (P7) +23: round-6 platform tools +1: knowledge-load (B50 P2)

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
