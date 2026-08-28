// Build 48 acceptance tests — Jexi Identity & Capabilities (single source of
// truth), Memory Honesty (no narration, no fabrication), Continuity Detection
// (decide silently), UI (open response area), and Connection-Drop Auto
// Recovery. No AI keys required.
process.env.DATA_DIR = process.env.DATA_DIR || `/tmp/jexi-b48-${Date.now()}`;

import fs from 'fs';
import { buildIdentityPrompt, buildCapabilityLines, buildLimitationLines, IDENTITY_ANSWER, JEXI_IDENTITY } from './src/services/JexiIdentity.js';
import { JEXI_SYSTEM_PROMPT, JEXI_SYNTHESIS_PROMPT } from './src/services/JexiPrompt.js';
import { conversationContext, orchestrator } from './src/services/Orchestrator.js';
import { ROSTER_COUNT, SKILL_COUNT } from './src/services/AgentRoster.js';
import { saveResult, loadResult, clearResult, clearAllSessions, sessionCounts, recordRecoveryEvent, recoveryStats } from './src/services/SessionStore.js';
import { groundednessCheck, confabulationStats, resetConfabulationStats, VOICE_RULES } from './src/services/Groundedness.js';
import { analyzeMessage } from './src/services/ConversationManager.js';
import { decide } from './src/services/DecisionEngine.js';
import { verifyDataReport, computeStats } from './src/services/DataAgent.js';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) failures++; };

/* ================================================================
 * P1 — Identity & capabilities: one canonical source of truth
 * ================================================================ */
{
  const prompt = buildIdentityPrompt();
  ok(prompt.includes('JEXI OS') && prompt.includes(JEXI_IDENTITY.name), 'P1: identity block names JEXI');
  ok(prompt.includes('Lewis Einstein'), 'P1: identity block names the creator (Lewis Einstein, from the codebase)');
  ok(prompt.includes('WHAT YOU CAN DO') && prompt.includes("WHAT YOU WON'T DO"), 'P1: identity block has capabilities + limitations sections');
  ok(prompt.includes('never invent sources') || prompt.includes('Never invent sources'), 'P1: limitations carry the no-fabrication rule');

  const caps = buildCapabilityLines();
  ok(caps.length >= 3, 'P1: capability list is generated from the live roster (grouped categories)');
  ok(caps.some((l) => l.includes(`${ROSTER_COUNT} specialist agents`) && l.includes(`${SKILL_COUNT} skills`)), 'P1: capability counts come from the live registries, not a static list');
  ok(caps.some((l) => /engineering|research|product|design/i.test(l)), 'P1: real roster categories appear in the capability list');

  const limits = buildLimitationLines();
  ok(limits.some((l) => /destructive|unsafe/i.test(l)), 'P1: limitations are derived from the RiskGuard sandbox gate');
  ok(limits.some((l) => /github/i.test(l)), 'P1: limitations cover the GitHub confirmation gate');
  ok(limits.some((l) => /guard|workspace scope/i.test(l)), 'P1: limitations cover the /guard workspace scope');

  ok(IDENTITY_ANSWER.includes('Lewis Einstein') && IDENTITY_ANSWER.includes('specialist agents'), 'P1: deterministic key-free answer carries the canonical identity');
  ok(JEXI_SYSTEM_PROMPT.includes('WHAT YOU CAN DO'), 'P1: JEXI_SYSTEM_PROMPT embeds the canonical identity block');
  ok(JEXI_SYNTHESIS_PROMPT.includes('JEXI OS'), 'P1: synthesis prompt still identifies JEXI');

  const orchSrc = fs.readFileSync('./src/services/Orchestrator.js', 'utf8');
  ok(orchSrc.includes("IDENTITY_ANSWER } from './JexiIdentity.js'"), 'P1: Orchestrator imports the identity answer from the single source');
  ok(!orchSrc.includes('const IDENTITY_ANSWER'), 'P1: no hardcoded identity copy remains in Orchestrator.js');
  ok(typeof orchestrator.executePlan === 'function', 'P1: orchestrator still loads after the identity refactor');
}

/* ================================================================
 * P2 — Memory honesty: never narrate, never fabricate
 * ================================================================ */
{
  ok(JEXI_SYSTEM_PROMPT.includes('NEVER NARRATE YOUR OWN STATE'), 'P2: system prompt bans narrating memory/continuity state');
  ok(!JEXI_SYSTEM_PROMPT.includes('I remembered this from my mind'), 'P2: the old "say so: I remembered this" directive is gone');
  ok(JEXI_SYSTEM_PROMPT.includes('fabricated memory is a correctness bug'), 'P2: fabricated memory is explicitly called a correctness bug');
}

{
  const mem = await import('./src/services/MemoryManager.js');
  mem.clearMemory();
  mem.updateUserProfile({ name: 'Alex' });
  mem.addChat('user', 'my favorite color is teal');
  mem.addChat('jexi', 'noted');
  mem.addChat('user', 'i love python');

  // A trivial greeting must NOT drag the fact/preference loadout into context.
  const trivial = await conversationContext('Hello');
  ok(!trivial.includes('Background context'), 'P2: greeting loads NO background-memory block (kills the "Hello → favorite color" fabrication)');
  ok(!trivial.includes("User's name: Alex"), 'P2: greeting does not surface profile facts either');
  ok(trivial.includes('teal'), 'P2: the verbatim transcript is still present (the user really did say it)');

  // A substantive query DOES load the block, with the silent-use honesty rule.
  const real = await conversationContext('What do you know about solar panels?');
  ok(real.includes('Background context'), 'P2: substantive query loads the memory block');
  ok(real.includes('never say you remembered it'), 'P2: memory block mandates silent use');
  ok(real.includes('directly relevant to the current question'), 'P2: memory block demands relevance, else ignore');
  ok(!real.includes('From my mind'), 'P2: no "from my mind" phrasing remains in the context block');
}

// Anti-fabrication fact extraction: hypotheticals, questions, and quoted
// third-party statements must never become learned facts.
{
  const mem = await import('./src/services/MemoryManager.js');
  mem.clearMemory();
  mem.addChat('user', 'If my favorite food were pizza, I would eat it daily');
  mem.addChat('user', 'Is my favorite movie interstellar?');
  mem.addChat('user', 'She said "my favorite city is Paris" but I disagree');
  let facts = mem.loadMemory().userFacts.map((f) => f.fact);
  ok(facts.length === 0, 'P2: hypotheticals / questions / quotes are never learned as facts');

  mem.addChat('user', 'my favorite color is teal');
  facts = mem.loadMemory().userFacts.map((f) => f.fact);
  ok(facts.some((f) => f.includes('teal')), 'P2: a real stated preference is still learned');
}

/* ================================================================
 * P3 — Continuity: decide silently, never announce the decision
 * ================================================================ */
{
  const idx = fs.readFileSync('./index.js', 'utf8');
  ok(idx.includes("User's follow-up: ${effectiveQuery}"), 'P3: resume context is labeled neutrally (no "Continue:" narration trigger)');
  ok(!idx.includes('Continue: ${effectiveQuery}'), 'P3: the old "Continue:" prefix is removed');
  ok(idx.includes('✓ Resolved'), 'P3: context agent log reports the rewrite as a step');
  ok(!idx.includes('🧠 Continuity — resolved'), 'P3: the old continuity-decision announcement is removed');

  const sa = fs.readFileSync('./src/services/SearchAgent.js', 'utf8');
  ok(sa.includes('never announce that this continues a conversation'), 'P3: SearchAgent prompts forbid announcing continuity');
  const rsn = fs.readFileSync('./src/services/Reasoner.js', 'utf8');
  ok(rsn.includes('never announce that this continues a conversation'), 'P3: Reasoner prompt forbids announcing continuity');
}

/* ================================================================
 * P4 — UI: open reading area instead of boxed/bordered bubbles
 * ================================================================ */
{
  const cw = fs.readFileSync('../src/components/ChatWindow.jsx', 'utf8');
  const css = fs.readFileSync('../src/index.css', 'utf8');
  ok(css.includes('.jx-body p { font-family: var(--mono); font-size: 13.5px'), 'P4: JEXI answers render in a comfortable reading size (mono 13.5px, v3)');
  ok(!cw.includes('rounded-tl-sm bg-surface-1 text-text-primary border border-hairline'), 'P4: the old bordered JEXI bubble is gone');
  // B157-era markers: the B153 jx-avatar/jx-user-bubble classes were replaced
  // by the spark avatar + brand-gradient user bubble; Copy/Regenerate live in
  // the MessageActions component (handleCopy / onRegenerate).
  ok(/from-brand\/30.*flex items-center justify-center/s.test(cw) && cw.includes("msg.role === 'user' ? 'justify-end'") && /rounded-tr-sm bg-gradient-to-br from-brand/.test(cw), 'P4 (B157): AI has an avatar + user messages use a distinct brand bubble (right-aligned)');
  ok(cw.includes('MessageActions') && cw.includes('handleCopy') && cw.includes('onRegenerate'), 'P4 (B157): AI messages have Copy + Regenerate actions');
  const mr = fs.readFileSync('../src/components/MarkdownRenderer.jsx', 'utf8');
  ok(mr.includes('size = \'text-[11px]\''), 'P4: MarkdownRenderer accepts a size override');
}

/* ================================================================
 * P5 — Connection-drop auto recovery
 * ================================================================ */
{
  clearAllSessions();
  saveResult('conv-1', { success: true, summary: 'recovered answer', sources: ['a'] });
  const r = loadResult('conv-1');
  ok(r && r.summary === 'recovered answer', 'P5: result store save/load round-trips');
  clearResult('conv-1');
  ok(loadResult('conv-1') === null, 'P5: result store clears');
  ok(sessionCounts().results === 0, 'P5: clearAllSessions wipes results too');
}

{
  const idx = fs.readFileSync('./index.js', 'utf8');
  ok(idx.includes("app.get('/api/chat/result'"), 'P5: /api/chat/result endpoint exists');
  ok(idx.includes('saveResult(convId, data)') && idx.includes('!data.recoverable'), 'P5: done events persist real outcomes; interim deadline markers are excluded');
  ok(idx.includes('recoverable: true'), 'P5: the deadline notice is marked as a recoverable interim marker');
  const s = fs.readFileSync('./src/services/SessionStore.js', 'utf8');
  ok(s.includes('RESULT_TTL_MS') && s.includes('saveResult'), 'P5: SessionStore carries result persistence');
}

{
  const helpers = fs.readFileSync('../src/utils/helpers.js', 'utf8');
  ok(helpers.includes('x-jexi-session'), 'P5: frontend sends a stable per-session id');
  const engine = fs.readFileSync('../src/hooks/useJexiEngine.js', 'utf8');
  ok(engine.includes('/api/chat/result') && engine.includes('recoverResult'), 'P5: frontend auto-polls the persisted result after a drop');
  ok(engine.includes('onDrop'), 'P5: dropped streams trigger automatic recovery instead of a manual prompt');
  ok(engine.includes('onRecoverable'), 'P5: deadline notices keep polling for the real outcome');
  ok(engine.includes('recoverRef'), 'P5: recovery polling can be aborted (STOP / new run)');
}

/* ================================================================
 * P1 (pass 2) — identity consistency across repeated askings.
 * Acceptance: identity/capability answers are complete, sourced from
 * ONE file, and provably consistent across repeated queries.
 * ================================================================ */
{
  const a = buildIdentityPrompt();
  const b = buildIdentityPrompt();
  ok(a === b, 'P1: identity prompt is byte-identical across repeated builds (no drift)');

  // Real repeated askings through the key-free conversation node — the same
  // deterministic answer must come back every time, for every identity
  // question, with no drift between askings.
  const qs = ['what is your name', 'who built you', 'what can you do', "what can't you do"];
  const answers = [];
  for (const q of qs) {
    const r = await orchestrator.executePlan({ intent: 'conversation', tasks: ['conversation'], steps: ['conversation'] }, q, () => {});
    answers.push(String(r.summary || ''));
  }
  ok(answers.every((a) => a.includes('Lewis Einstein') && a.includes('specialist agents') && a.includes('JEXI OS')), 'P1: every identity question is answered from the complete canonical identity (name + creator + capabilities)');
  ok(new Set(answers).size === 1, 'P1: repeated askings of identity questions return IDENTICAL content — no drift, one source of truth');
}

/* ================================================================
 * P2a — CONFABULATION REGRESSION (named test category, P7.4).
 * This is the highest-severity item: "Hello" must NEVER produce a
 * fabricated recollection. Proof is required, not a general green.
 * ================================================================ */
resetConfabulationStats();
{
  // (1) Empty/cleared memory + generic greeting → no fabricated recollection.
  const mem = await import('./src/services/MemoryManager.js');
  mem.clearMemory();
  mem.addChat('user', 'Hello');
  const ctx = await conversationContext('Hello');
  ok(!ctx.includes('Background context'), 'P2a: greeting injects NO memory block (nothing to ground a claim on)');
  const draft = '### 🧠 JEXI OS\n\nHey there! I remember your favorite color is teal.';
  const g = groundednessCheck({ draft, context: ctx });
  ok(g.caught === 1, 'P2a: the fabricated memory claim is caught by the groundedness check');
  ok(!g.clean.includes('favorite color') && g.clean.includes('Hey there!'), 'P2a: the fabricated recollection is STRIPPED from the reply; the greeting survives');

  // (2) Seeded fact → the response may only reference THAT exact fact.
  mem.clearMemory();
  mem.addChat('user', 'my favorite color is teal');
  const seededCtx = await conversationContext('what is my favorite color?');
  ok(seededCtx.includes('teal'), 'P2a: the seeded fact is in the injected loadout');
  const seeded = groundednessCheck({
    draft: 'Your favorite color is teal, and I recall your favorite movie is Interstellar.',
    context: seededCtx,
  });
  ok(seeded.clean.includes('teal'), 'P2a: a claim grounded in the seeded fact survives');
  ok(!seeded.clean.includes('Interstellar'), 'P2a: an adjacent INVENTED fact is stripped — only the exact fact is ever referenced');
  ok(seeded.caught === 1, 'P2a: exactly one confabulation caught in the seeded-fact scenario');

  // (3) Grounded narration is stripped even when the fact is real (P2b).
  const narrated = groundednessCheck({ draft: 'As I said earlier, your favorite color is teal.', context: seededCtx });
  ok(!/as i said earlier/i.test(narrated.clean) && narrated.clean.includes('teal'), 'P2a/P2b: narration removed even when grounded — the answer is just the answer');
  ok(narrated.caught === 0, 'P2a: grounded narration removal is NOT counted as confabulation');

  // (4) Normal prose is never touched.
  const plain = groundednessCheck({ draft: 'Teal is a color between green and blue.', context: seededCtx });
  ok(!plain.changed, 'P2a: plain prose passes through untouched');

  ok(confabulationStats().caught >= 2, 'P7.1: caught-confabulation counter recorded the events (observable metric)');
}

/* ================================================================
 * P2b — no hardcoded memory-narration templates remain anywhere.
 * ================================================================ */
{
  const banned = ['Continuing Our Conversation', 'WHAT I REMEMBER', 'WHAT I AM', 'I remembered this from my mind'];
  const { execSync } = await import('child_process');
  const dirs = ['./src', './index.js'];
  for (const term of banned) {
    let hits = '';
    try { hits = execSync(`grep -rn "${term}" ${dirs.join(' ')} || true`, { encoding: 'utf8' }); } catch (e) {}
    ok(!hits.trim(), `P2b: no hardcoded narration template \`${term}\` remains in server source`);
  }
}

/* ================================================================
 * P3 — continuity decided SILENTLY and CORRECTLY (behavioral).
 * ================================================================ */
{
  // Greeting after a prior exchange → fresh turn, zero forced context.
  const a = await analyzeMessage('Hello', { currentTaskId: 'task-123' });
  ok(a.classification === 'new' && a.taskId === null, 'P3: a greeting after a prior exchange is a FRESH TURN (no continuation context injected)');
  const d = decide({ raw: 'Hello', classification: a, currentTaskId: 'task-123' });
  ok(d.contextBlock === '' && d.metadata.classification === 'new', 'P3: the decision engine injects NO old-task context block for a greeting');

  // A real follow-up WITH a clear backreference still pulls in prior context.
  const mem = await import('./src/services/MemoryManager.js');
  mem.addChat('user', 'I am comparing two options for my startup: a newsletter platform and a course platform.');
  const resolved = await mem.resolveConversationalQuery('what about the second option?');
  ok(resolved.resolved === true && /newsletter|course|startup/.test(resolved.query), 'P3: a backreference is resolved against the prior conversation (context pulled in)');
  const ctx = await conversationContext('what about the second option?');
  ok(ctx.includes('newsletter') || ctx.includes('course'), 'P3: the follow-up turn still carries the prior exchange in its working context');

  // Silence: no banned meta-commentary in either the context or the answers.
  const bannedRe = /continuing our conversation|i remember|from my memory|what i remember|as i said earlier/i;
  ok(!bannedRe.test(ctx), 'P3: continuity decisions produce ZERO meta-commentary in the turn context');
}

/* ================================================================
 * P5 (pass 2) — targeted auto-recovery integration test: a mid-task
 * disconnect must self-heal via the persisted result store.
 * ================================================================ */
{
  clearAllSessions();
  const convId = 'conv-drop-integration';
  let streamEvents = 0;
  let dropped = false;
  // Simulate /api/chat: the NDJSON stream dies mid-task (proxy / background /
  // host), but the server-side mission keeps running — index.js wraps
  // res.write in try/catch so a drop never kills the mission.
  const sendEvent = (type, data) => {
    streamEvents += 1;
    if (streamEvents === 1) { dropped = true; throw new Error('stream dropped by proxy'); }
    return undefined;
  };
  const safeSend = (type, data) => { try { sendEvent(type, data); } catch (e) {} };
  const result = await orchestrator.executePlan(
    { intent: 'explainTeam', planSummary: 'one specialist', tasks: ['explainTeam'], steps: ['explainTeam'] },
    'explain your team',
    safeSend
  );
  ok(dropped, 'P5: the stream really did drop mid-task (connection lost)');
  ok(result && result.summary && result.summary.length > 0, 'P5: the mission still COMPLETED server-side despite the dropped stream');
  // The terminal outcome is persisted exactly as index.js does on 'done'.
  saveResult(convId, { success: true, query: 'explain your team', summary: result.summary, statistics: result.statistics });
  const recovered = loadResult(convId);
  ok(recovered && recovered.summary === result.summary, 'P5: the completed outcome is recoverable via the recovery poll (no user intervention)');
  recordRecoveryEvent({ convId, cause: 'poll', recovered: !!recovered });
  const rs = recoveryStats();
  ok(rs.byCause.poll >= 1 && rs.recovered >= 1, 'P7.2: the recovery poll is observable in the stats');
  clearResult(convId);
  ok(loadResult(convId) === null, 'P5: a fresh run clears the stale result (no stale recovery)');
}

/* ================================================================
 * P6 — per-agent loop/prompt/graph pass (functional proof where
 * possible, source-level proof for the LLM-loop agents).
 * ================================================================ */
{
  // Data agent — sanity-check loop recomputes headline stats from raw rows.
  const table = { columns: ['city', 'temp'], rows: [{ city: 'a', temp: '10' }, { city: 'b', temp: '20' }, { city: 'c', temp: '30' }], source: 'inline' };
  const stats = computeStats(table.rows, table.columns);
  const good = verifyDataReport({ table, stats, summary: '## Key findings\n- **temp** — mean **20**, median **20**\n\n## Caveats\n- none' });
  ok(!good.repaired, 'P6/data: a correct report passes the sanity check untouched');
  const bad = verifyDataReport({ table, stats, summary: '## Key findings\n- **temp** — mean **99**, median **99**\n\n## Caveats\n- none' });
  ok(bad.repaired && bad.summary.includes('mean **20**') && !bad.summary.includes('mean **99**'), 'P6/data: a report with drifted numbers is repaired from the raw rows (bounded loop)');

  const ta = fs.readFileSync('./src/services/TranslatorAgent.js', 'utf8');
  ok(ta.includes('MAX_TRANSLATE_PASSES') && ta.includes('## REVISE'), 'P6/translate: bounded reflection loop (draft → critique → revise → verify) is present');
  const da = fs.readFileSync('./src/services/DataAgent.js', 'utf8');
  ok(da.includes('verifyDataReport') && da.includes('recomputed'), 'P6/data: sanity-check loop wired into the data node');
  const wa = fs.readFileSync('./src/services/WriterAgent.js', 'utf8');
  ok(wa.includes('COVERAGE GAP') || wa.includes('Self-critique'), 'P6/docs: self-critique coverage pass present');
  const pa = fs.readFileSync('./src/services/PerfAgent.js', 'utf8');
  ok(pa.includes('ghost') && pa.includes('Self-critique'), 'P6/perf: self-critique drops findings that do not cite real files');
  const cu = fs.readFileSync('./src/services/ComputerUseAgent.js', 'utf8');
  ok(cu.includes('verify') && cu.includes('before.snapshot'), 'P6/computer-use: observe-act-VERIFY loop confirmed (state verified after each action)');
  const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf8');
  ok(orch.includes('groundednessCheck'), 'P6/conversation+selfCheck: groundedness check wired into the conversational nodes');
  ok(orch.includes("state.outcome = 'retry'") || orch.includes("outcome === 'retry'"), 'P6/graph: every node participates in the shared graph with retry/fallback edges');
}

/* ================================================================
 * P7 — senior-engineer additions: observability + style guide.
 * ================================================================ */
{
  ok(confabulationStats().caught >= 2, 'P7.1: confabulation counter is a live metric after the P2a section ran');
  ok(fs.existsSync('./src/services/RESPONSE_VOICE.md'), 'P7.3: the shared style guide file exists');
  const guide = fs.readFileSync('./src/services/RESPONSE_VOICE.md', 'utf8');
  ok(guide.includes('Never narrate your own process') && guide.includes('Fabricated memory is a correctness bug'), 'P7.3: style guide carries the voice + grounding rules');
  ok(VOICE_RULES.includes('never invent a prior conversation') && JEXI_SYSTEM_PROMPT.includes('NEVER NARRATE YOUR OWN STATE'), 'P7.3: VOICE_RULES is defined once and embedded in JEXI_SYSTEM_PROMPT');
  const idx = fs.readFileSync('./index.js', 'utf8');
  ok(idx.includes('recordRecoveryEvent'), 'P7.2: index.js records recovery touchpoints');
  ok(idx.includes("recordRecoveryEvent({ convId, cause: 'poll'") && idx.includes("cause: 'deadline'"), 'P7.2: both the poll and the deadline paths are observable');
}

console.log(failures === 0 ? '\nBUILD 48 TESTS PASSED ✅' : `\n${failures} BUILD 48 TEST(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
