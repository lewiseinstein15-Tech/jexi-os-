/**
 * JEXI OS — B55 acceptance suite (OpenWorker risk-tiered execution model).
 *
 * Deterministic (no LLM needed) against the real ToolRuntime / MemoryManager /
 * mcp-server services:
 *
 *   P1 — 4-tier risk classification + the EXTERNAL approval gate
 *   P2 — state re-asking fix: short self-contained messages never rewritten;
 *        any rewrite must preserve the user's concrete details
 *   P4 — attach generic MCP tools via registerMcpTool (EXTERNAL tier only)
 *   P5 — a tool call is only "done" when the real tool response confirms it
 */
process.env.DATA_DIR = process.env.DATA_DIR || `/tmp/jexi-b55-${Date.now()}`;
// Deterministic: no provider keys → resolveConversationalQuery uses its
// deterministic paths only (the P2 fix under test fires before any LLM call).
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.CEREBRAS_API_KEY;
delete process.env.DEEPINFRA_API_KEY;
delete process.env.MISTRAL_API_KEY;
delete process.env.XAI_API_KEY;
delete process.env.HF_TOKEN;

const {
  executeTool, toolTier, isToolDone, getToolCatalog,
} = await import('./src/services/ToolRuntime.js');
const {
  resolveConversationalQuery, hasOwnDetails, rewritePreservesDetails, addChat,
} = await import('./src/services/MemoryManager.js');
const { registerMcpTool, callMcpTool, listMcpTools, mcpToolTier } = await import('./mcp-server.js');

let passed = 0;
let failed = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { passed++; console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

/* ------------------------------------------------------------------ */
console.log('\n== B55 P1 — RISK-TIERED TOOL CALLS (typed 4-tier wrapper) ==');
/* ------------------------------------------------------------------ */

ok(toolTier('web-search') === 'read', 'web-search is READ (always autonomous)');
ok(toolTier('deep-read') === 'read', 'deep-read is READ');
ok(toolTier('memory-recall') === 'read', 'memory-recall is READ');
ok(toolTier('memory-write') === 'write_local', 'memory-write is WRITE_LOCAL (autonomous, own data)');
ok(toolTier('code-write') === 'write_local', 'code-write is WRITE_LOCAL');
ok(toolTier('code-run') === 'exec', 'code-run is EXEC (autonomous by default, logged)');
ok(toolTier('github-cli') === 'external', 'github-cli is EXTERNAL (sends/irreversible)');
ok(toolTier('form-fill') === 'external', 'form-fill is EXTERNAL');
ok(toolTier('mcp-call', { tool: 'get_health' }) === 'read', 'built-in read-only MCP tool is READ');
ok(toolTier('mcp-call', { tool: 'anything_else' }) === 'external', 'non-builtin mcp-call defaults to EXTERNAL (conservative)');

// EXTERNAL gate — no confirm callback → refused with real finalized details.
const needApproval = await executeTool({ slug: 'github-cli', args: { command: 'gh repo create jexi-x --public' }, profile: 'full' });
ok(needApproval.ok === false && needApproval.approvalRequired === true && needApproval.tier === 'external',
  'EXTERNAL tool without a confirm callback → approvalRequired (never auto-runs)', needApproval.error || '');
ok(needApproval.details && needApproval.details.includes('jexi-x'), 'approval carries the REAL finalized details, not placeholders', needApproval.details || '');

// EXTERNAL gate — confirm declines → cancelled, nothing runs.
let confirmCalls = 0;
const declined = await executeTool({ slug: 'github-cli', args: { command: 'gh repo delete jexi-x --yes' }, profile: 'full', confirm: async (p) => { confirmCalls++; ok(p.risk === 'irreversible' && p.details.includes('jexi-x'), 'confirm payload is the finalized plan (real details)'); return false; } });
ok(declined.ok === false && declined.declined === true && confirmCalls === 1, 'EXTERNAL + confirm(false) → declined, exactly one approval asked');

// EXTERNAL gate — confirm parks (graph confirmationPause machinery).
const parked = await executeTool({ slug: 'github-cli', args: { command: 'gh repo delete jexi-x --yes' }, profile: 'full', confirm: async () => 'paused' });
ok(parked.ok === false && parked.paused === true && parked.approvalRequired === true, 'EXTERNAL + confirm("paused") → parks for the graph pause/resume');

// EXTERNAL gate — approved external MCP tool actually runs (through the
// registerMcpTool attach path, P4), and READ-tier tools never confirm.
let ran = false;
registerMcpTool({
  name: 'b55_send_message',
  description: 'Test external MCP tool',
  handler: async () => { ran = true; return { content: [{ type: 'text', text: 'sent' }], structuredContent: { ok: true, sentTo: 'test' } }; },
});
const approved = await executeTool({ slug: 'mcp-call', args: { tool: 'b55_send_message', args: { channel: '#ops' } }, profile: 'full', confirm: async (p) => { ok(p.details.includes('b55_send_message'), 'approved MCP call shows finalized details', p.details || ''); return true; } });
ok(approved.ok === true && ran === true, 'EXTERNAL + confirm(true) → runs once approved');
ok(isToolDone(approved) === true, 'a REAL tool response counts as done');

const readRun = await executeTool({ slug: 'mcp-call', args: { tool: 'get_health' }, profile: 'full' });
ok(readRun.ok === true && readRun.tier === 'read', 'READ-tier tool runs autonomously — no confirmation asked');

// Catalog exposes the tier (UI can show it).
const catalog = getToolCatalog();
const gh = catalog.find((t) => t.slug === 'github-cli');
ok(gh && gh.tier === 'external' && catalog.find((t) => t.slug === 'web-search').tier === 'read', 'getToolCatalog() exposes the risk tier per tool');

/* ------------------------------------------------------------------ */
console.log('\n== B55 P2 — STATE RE-ASKING FIX (never re-ask for details already given) ==');
/* ------------------------------------------------------------------ */

ok(hasOwnDetails('remind me friday 3pm') === true, 'short message WITH its own date/time is detected as self-contained');
ok(hasOwnDetails('add dark mode') === false, 'plain instruction without concrete details is not "detail-carrying"');
ok(hasOwnDetails('pay $40 for the upgrade') === true, 'amounts count as details');

ok(rewritePreservesDetails('book it for friday 3pm', 'book the table for friday') === false, 'a rewrite that DROPS the time is rejected');
ok(rewritePreservesDetails('book it for friday 3pm', 'book the table at luigis for friday at 3 pm') === true, 'a rewrite that KEEPS all details passes');
ok(rewritePreservesDetails('what is the derivative of x squared', 'what is the derivative of x^2') === true, 'detail-free messages never block the rewrite');

// End-to-end: a short message that already carries its own details is NEVER
// rewritten against the transcript (the pre-check fires before any LLM call).
addChat('user', 'Set up a dentist appointment reminder system for me.');
addChat('jexi', 'Done — I built the reminder system and saved it to your workspace.');
const pre = await resolveConversationalQuery('remind me friday 3pm');
ok(pre.resolved === false && pre.query === 'remind me friday 3pm', '"remind me friday 3pm" passes through UNCHANGED (no lossy rewrite, no re-ask)', pre.reason || '');
// And an anaphoric continuation still resolves normally (deterministic anchor).
const an = await resolveConversationalQuery('continue it');
ok(an.resolved === true && an.query.includes('reminder'), 'genuine continuation ("continue it") still resolves against context', an.query || '');

/* ------------------------------------------------------------------ */
console.log('\n== B55 P4 — MCP ATTACH (generic tools alongside custom connectors) ==');
/* ------------------------------------------------------------------ */

let registerError = '';
try { registerMcpTool({ name: 'get_health', handler: async () => ({ ok: true }) }); } catch (e) { registerError = e.message; }
ok(registerError.includes('built-in'), 'cannot shadow a built-in MCP tool name');
let tierError = '';
try { registerMcpTool({ name: 'b55_read_only', tier: 'read', handler: async () => ({ ok: true }) }); } catch (e) { tierError = e.message; }
ok(tierError.includes('EXTERNAL'), 'attached tools may ONLY register as EXTERNAL tier (hard-enforced risk model)');

const viaCall = await callMcpTool('b55_send_message', { channel: '#ops' });
ok(viaCall.ok === true && viaCall.result?.sentTo === 'test', 'attached MCP tool is callable through the validated mcp-call path');
const listing = listMcpTools();
ok(listing.some((t) => t.name === 'b55_send_message' && t.tier === 'external' && !t.builtin), 'listMcpTools() includes attached tools with their tier');
ok(listing.some((t) => t.name === 'get_health' && t.tier === 'read' && t.builtin), 'built-in allowlist still listed (custom connectors untouched)');
ok(mcpToolTier('b55_send_message') === 'external', 'mcpToolTier() reports external for attached tools');

/* ------------------------------------------------------------------ */
console.log('\n== B55 P5 — NO FABRICATED COMPLETION ==');
/* ------------------------------------------------------------------ */

ok(isToolDone({ ok: true }) === true, 'real completed response → done');
ok(isToolDone({ ok: true, routed: true }) === false, 'routed-but-not-executed is NEVER done');
ok(isToolDone({ ok: false }) === false, 'failure is never done');
ok(isToolDone({ ok: false, paused: true }) === false, 'paused/awaiting-approval is never done');
ok(isToolDone({ ok: false, approvalRequired: true }) === false, 'approval-required is never done');

// Registry-only tool (no real engine): executeTool returns an honest "routed"
// result — NOT a fake success — so callers must not report it as completed.
const routed = await executeTool({ slug: 'email-draft', args: { topic: 'Q3 newsletter' } });
ok(routed.ok === true && routed.routed === true && isToolDone(routed) === false, 'registry-only tool returns routed=true (honest) and is NOT counted as done', routed.result ? routed.result.slice(0, 80) : '');
ok(String(routed.result).includes('routed'), 'the routed message says the tool did NOT execute — never a fabricated success');

// An unknown mcp-call target is EXTERNAL by default → refused before it can
// ever execute (the approval gate is the first hard line of defence).
const refusedUnknown = await executeTool({ slug: 'mcp-call', args: { tool: 'no_such_tool' }, profile: 'full' });
ok(refusedUnknown.ok === false && refusedUnknown.approvalRequired === true, 'unapproved external call is refused BEFORE any execution (fail closed)');
// Even after approval, an unavailable tool stays an honest failure.
const unknownMcp = await executeTool({ slug: 'mcp-call', args: { tool: 'no_such_tool' }, profile: 'full', confirm: async () => true });
ok(unknownMcp.ok === false && String(unknownMcp.error).includes('No MCP tool'), 'unavailable tool is reported honestly (fail-closed)');

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
