/**
 * Stage 9 (unified tool runtime) + Stage 12 (tool-calling loop) tests.
 * Everything here is deterministic and needs no API keys:
 *   - catalog / schema / permission classification
 *   - profile gating (blocked vs allowed)
 *   - argument validation
 *   - real engine calls that need no keys (memory-write, profile-read)
 *   - B67 native tool-calling: schema building + the loop mechanics (the
 *     __mockCompletions seam drives the loop without network calls)
 */
import { getToolCatalog, TOOL_PROFILES, toolPermission, activeToolProfile, setToolProfile, executeTool, buildNativeSchemas } from './src/services/ToolRuntime.js';
import { generateWithToolsLoop } from './src/services/LLMClient.js';
import { executeNativeToolCalls } from './src/services/WorkerRouter.js';
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

/* ---------------- Stage 12 (B67): NATIVE tool-calling loop ---------------- */
// 1. buildNativeSchemas: flat TOOL_SCHEMAS-style defs → OpenAI function schemas.
const schemas = buildNativeSchemas([
  { slug: 'memory-recall', name: 'Memory Recall', desc: 'Recall facts', schema: { query: { type: 'string', required: true, desc: 'What to recall' }, limit: { type: 'number', desc: 'Max' } } },
  { slug: 'profile-read', name: 'Profile Read', desc: 'Read profile', schema: {} },
  { slug: 'no-engine-tool', name: 'No Engine', desc: 'Registry-only', schema: null },
  { slug: 'weather-now', name: 'Weather Now', desc: 'Plugin tool', args: { city: { type: 'string', required: true, desc: 'City' } } }, // plugin style (B105)
]);
check('buildNativeSchemas emits OpenAI function shape', schemas.length === 4 && schemas.every((s) => s.type === 'function' && s.function && s.function.name && s.function.parameters));
check('buildNativeSchemas marks required args', schemas[0].function.parameters.required.includes('query'));
check('buildNativeSchemas types number args as number', schemas[0].function.parameters.properties.limit.type === 'number');
// B105 — schema-less defs get a GENERIC schema (never silently dropped) and
// plugin-style `args` become provider-ready parameters.
check('buildNativeSchemas keeps schema-less defs (generic fallback)', schemas.some((s) => s.function.name === 'no-engine-tool' && s.function.parameters && s.function.parameters.type === 'object'));
check('buildNativeSchemas accepts plugin-style args', schemas.some((s) => s.function.name === 'weather-now' && s.function.parameters.properties.city));

// 2. The native loop executes declared tool calls through the injected
//    executor and keeps looping until the model answers directly.
let executedNames = [];
const loopRes = await generateWithToolsLoop('q', 'sys', schemas, {
  __mockCompletions: [
    { text: '', toolCalls: [{ id: 'call_1', name: 'memory-recall', arguments: { query: 'preferences' } }] },
    { text: 'Here is the final answer.', toolCalls: [] },
  ],
  executeToolCalls: async (calls) => {
    executedNames.push(...calls.map((c) => c.name));
    return calls.map((c) => ({ tool_call_id: c.id, content: 'RESULT for ' + c.name }));
  },
});
check('native loop executed the tool call', executedNames.length === 1 && executedNames[0] === 'memory-recall');
check('native loop returned the tool calls', (loopRes.toolCalls || []).length === 1);
check('native loop ran 2 rounds then answered', loopRes.iterations === 2 && loopRes.text === 'Here is the final answer.');

// 3. When the model answers directly, no tools are executed.
let directCalls = 0;
const directRes = await generateWithToolsLoop('q', 'sys', schemas, {
  __mockCompletions: [{ text: 'Direct answer.', toolCalls: [] }],
  executeToolCalls: async () => { directCalls++; return []; },
});
check('no tool execution when the model answers directly', directCalls === 0 && directRes.iterations === 1 && directRes.text === 'Direct answer.');

// 4. executeNativeToolCalls runs through the REAL gated runtime (keyless
//    memory engine) and preserves the call id for the round-trip.
const native = await executeNativeToolCalls([{ id: 'call_7', name: 'memory-recall', arguments: { query: 'quantum' } }], { profile: 'auto', intent: 'conversation' });
check('executeNativeToolCalls returns tool_call_id', native.length === 1 && native[0].tool_call_id === 'call_7');
check('executeNativeToolCalls returns real engine content', typeof native[0].content === 'string' && native[0].content.length > 0 && !native[0].content.startsWith('ERROR'));

// 5. A blocked tool is reported honestly (never a fake success).
const blockedNative = await executeNativeToolCalls([{ id: 'call_8', name: 'code-run', arguments: { command: 'echo hi' } }], { profile: 'auto' });
check('executeNativeToolCalls reports blocked tools honestly', blockedNative.length === 1 && blockedNative[0].content.startsWith('ERROR') && /permission/.test(blockedNative[0].content));

/* ---------------- Registry sanity (used by the loop) ---------------- */
check('getTool finds web-search', getTool('web-search')?.name === 'Web Search');
check('registry count is 193', TOOL_COUNT === 193); // B110 +2: ask_user_question, exit_plan_mode (B106 +4; B100 +1: spill-read; B99 +1: run_code; B98 +1: skill-search; B96 +7)

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
