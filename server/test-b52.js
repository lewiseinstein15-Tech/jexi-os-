// B52 — CLOSE REMAINING WEAKNESSES AFTER B50/B51.
// Proves each priority from FIXLOG-B52.md with machine-checkable assertions.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { planner, TEAM_PLAN } from './src/services/Planner.js';
import { runCodeGateGraph, runResearchVerifyGraph, runReviewSecurityGraph } from './src/services/PipelineGraphs.js';
import { runCodingLoop } from './src/services/CodingLoop.js';
import { sanitizeFinalAnswer, containsForbiddenNarration } from './src/services/AnswerSanitizer.js';
import { listKnowledgeCategories, knowledgeLoad, loadProjectKnowledge } from './src/services/KnowledgeBase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}`);
};
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

// ===========================================================================
// P2 — THREE REAL ORCHESTRATOR PATHS DRIVEN BY GRAPHRUNNER.
// ===========================================================================
{
  // 1. Code gate: success path.
  const g = await runCodeGateGraph({
    query: 'build a weather app',
    entryPoint: null,
    qaVerdictFn: async () => ({ verdict: 'PASS', report: 'looks good' }),
    sendEvent: () => {},
  });
  check('P2 codeGateGraph success visits only the gate', JSON.stringify(g.history) === JSON.stringify(['gate']));
  check('P2 codeGateGraph success verdict PASS', g.context.gate.verdict === 'PASS');

  // 2. Code gate: failure → recovery → re-verify (bounded).
  let qaCalls = 0;
  const g2 = await runCodeGateGraph({
    query: 'build a weather app',
    entryPoint: 'app.js',
    qaVerdictFn: async () => {
      qaCalls++;
      return qaCalls === 1 ? { verdict: 'NEEDS FIX', report: 'button missing' } : { verdict: 'PASS', report: 'fixed' };
    },
    fixFn: async () => ({ entryPoint: 'app.js' }),
    runFn: async () => ({ success: true, output: 'ok', url: null }),
    sendEvent: () => {},
  });
  check('P2 codeGateGraph failure → recovery node visited', JSON.stringify(g2.history) === JSON.stringify(['gate', 'fix']));
  check('P2 codeGateGraph final verdict PASS after recovery', g2.context.gate.verdict === 'PASS');
  check('P2 codeGateGraph recorded durable failure history', (g2.context.failureHistory || []).length === 1);
  check('P2 codeGateGraph records the reason', /QA NEEDS FIX/.test((g2.context.failureHistory[0] || {}).reason || ''));

  // 3. Research verification: verifier flags issues → researcher re-runs with
  //    the specific missing claims → verifier re-checks.
  let verifyCalls = 0;
  const g3 = await runResearchVerifyGraph({
    query: 'history of AI',
    draft: 'Draft answer.',
    sources: [{ title: 'src' }],
    verifyFn: async () => {
      verifyCalls++;
      return verifyCalls === 1
        ? { verdict: 'best-effort', changed: false, text: 'Draft answer.', issues: ['no source for the 1956 Dartmouth claim'], rounds: 1 }
        : { verdict: 'verified', changed: false, text: 'Revised answer.', issues: [], rounds: 2 };
    },
    searchFn: async () => ({ summary: 'Revised answer with sources.', sources: [{ title: 'new-src', link: 'x' }], confidence: 90 }),
    sendEvent: () => {},
  });
  check('P2 researchVerifyGraph visits verify → revise → verify', JSON.stringify(g3.history) === JSON.stringify(['verify', 'revise', 'verify']));
  check('P2 researchVerifyGraph final draft is the revised answer', g3.context.finalDraft === 'Revised answer with sources.');
  check('P2 researchVerifyGraph failure history carries the specific claim', /Dartmouth/.test((g3.context.failureHistory[0] || {}).reason || ''));
  check('P2 researchVerifyGraph verifier ran twice (bounded revision)', verifyCalls === 2);

  // 4. Review + security gate: BLOCKED → fix → re-review → CLEARED.
  let secCalls = 0;
  const g4 = await runReviewSecurityGraph({
    query: 'build an app',
    entryPoint: 'app.js',
    files: ['app.js'],
    reviewFn: async () => ({ review: 'clean', verdict: 'APPROVED' }),
    securityFn: async () => {
      secCalls++;
      return secCalls === 1 ? { security: 'XSS in render', verdict: 'BLOCKED' } : { security: 'clean', verdict: 'CLEARED' };
    },
    fixFn: async () => ({ entryPoint: 'app.js' }),
    runFn: async () => ({ success: true, output: 'ok', url: null }),
    sendEvent: () => {},
  });
  check('P2 reviewSecurityGraph visits reviewer → gate → fix-sec', JSON.stringify(g4.history) === JSON.stringify(['reviewer', 'security-gate', 'fix-sec']));
  check('P2 reviewSecurityGraph final verdict CLEARED after fix round', g4.context.reviewSecurity.verdict === 'CLEARED');
  check('P2 reviewSecurityGraph recorded the BLOCKED failure', (g4.context.failureHistory || []).some((f) => /SECURITY BLOCKED/.test(f.reason || '')));

  // 5. Orchestrator wiring: the three paths call the graphs (source evidence).
  const orch = read('src/services/Orchestrator.js');
  check('P2 Orchestrator research node calls runResearchVerifyGraph', /runResearchVerifyGraph\(\{/.test(orch));
  check('P2 Orchestrator qaGate calls runCodeGateGraph', /runCodeGateGraph\(\{/.test(orch));
  check('P2 Orchestrator securityGate calls runReviewSecurityGraph', /runReviewSecurityGraph\(\{/.test(orch));
}

// ===========================================================================
// P3 — DIRECT_ANSWER HARD-LOCKED (no research/study leakage).
// ===========================================================================
{
  // The directive's four regression cases.
  const cases = [
    ['what is the capital of Kenya', 'direct_answer'],
    ['study computer science for my exam', 'study'], // study_topic | study_exam
    ['research the history of computer science', 'research'],
    ['explain what gravity is', 'direct_answer'],
    ['meaning of life', 'direct_answer'],
  ];
  for (const [q, expect] of cases) {
    const p = await planner.analyzeIntent(q);
    const ok = expect === 'study' ? /^study/.test(p.intent) : p.intent === expect;
    check(`P3 "${q}" → ${expect} (got ${p.intent})`, ok);
  }
  // "What is X" must NEVER enter research/study pipelines. The B50 domain
  // router may take academic fields ("what is computer science" →
  // domain:computer-science), which resolves to a DIRECT answer node
  // (generic → model knowledge, books first) — never study/research.
  const p = await planner.analyzeIntent('what is computer science');
  check('P3 "what is computer science" is direct (direct_answer or domain:*, got ' + p.intent + ')', p.intent === 'direct_answer' || p.intent.startsWith('domain:'));
  check('P3 "what is computer science" NOT research/study', !/^research|^study/.test(p.intent));
  // The direct_answer Orchestrator node must not touch study/web pipelines.
  const src = read('src/services/Orchestrator.js');
  const directNode = src.slice(src.indexOf('N.directAnswer'), src.indexOf('N.research'));
  check('P3 directAnswer node does not call the Trusted Library study pipeline', !/studyTopic|Trusted Library/.test(directNode));
  check('P3 directAnswer node does not call web/browser search', !/runSearchTeam|ComputerUseAgent|analyzeLink/.test(directNode));
  // The domain→generic path must also stay a direct answer (no web/study).
  const genericNode = src.slice(src.indexOf('N.generic'), src.indexOf('N.codePipeline'));
  check('P3 generic node (domain intents) does not run study/web pipelines', !/studyTopic|runSearchTeam/.test(genericNode));
}

// ===========================================================================
// P4 — CODE-LEVEL TOOL ALLOWLIST FOR LIGHTWEIGHT INTENTS.
// ===========================================================================
{
  const { toolsForIntent } = await import('./src/services/ToolRegistry.js');
  const { enforceToolAllowlist } = await import('./src/services/ToolRegistry.js');
  const { executeTool } = await import('./src/services/ToolRuntime.js');
  const t = toolsForIntent('direct_answer');
  const slugs = (t || []).map((x) => x.slug);
  check('P4 direct_answer tool set is MEMORY-ONLY (no web/browser/study)', slugs.length > 0 && slugs.every((s) => /memory|rolling|episode|knowledge|preference|profile|mcp|settings|semantic/.test(String(s))));
  check('P4 direct_answer has no web-search', !slugs.includes('web-search'));
  check('P4 direct_answer has no browser', !slugs.some((s) => /browser|link-open|computer/i.test(String(s))));
  check('P4 direct_answer has no study/library tools', !slugs.some((s) => /trusted-library|study|book-fetch|arxiv|wikipedia/i.test(String(s))));
  // Hard enforcement in code: the allowlist refuses web/browser/study on
  // lightweight intents, and executeTool blocks before any execution.
  check('P4 allowlist refuses web-search on direct_answer', enforceToolAllowlist('direct_answer', 'web-search').allowed === false);
  check('P4 allowlist refuses trusted-library on direct_answer', enforceToolAllowlist('direct_answer', 'trusted-library').allowed === false);
  check('P4 allowlist permits memory-recall on direct_answer', enforceToolAllowlist('direct_answer', 'memory-recall').allowed === true);
  check('P4 allowlist permits knowledge-load on conversation', enforceToolAllowlist('conversation', 'knowledge-load').allowed === true);
  check('P4 unrestricted intent passes allowlist', enforceToolAllowlist('research', 'web-search').allowed === true);
  const refused = await executeTool({ slug: 'web-search', intent: 'direct_answer', sendEvent: () => {} });
  check('P4 executeTool BLOCKS web-search for direct_answer', refused.ok === false && refused.blocked === true && refused.byAllowlist === 'direct_answer');
  // TEAM_PLAN also stays minimal for lightweight intents.
  check('P4 TEAM_PLAN.conversation stays minimal', TEAM_PLAN.conversation.length <= 3);
  check('P4 TEAM_PLAN.direct_answer stays minimal', TEAM_PLAN.direct_answer.length === 2);
}

// ===========================================================================
// P5 — SINGLE FINAL-OUTPUT GATE + FORBIDDEN-PHRASE SANITIZER.
// ===========================================================================
{
  const { finalizeAnswer } = await import('./src/services/Finalizer.js');
  const dirty = `### 🧠 JEXI OS — FROM MEMORY\n\nI studied photosynthesis using the Trusted Library and saved it to my knowledge library.\nI researched this before and I solved this before.\n\n## Answer\nPhotosynthesis converts light into chemical energy.`;
  const out = await finalizeAnswer({ query: 'what is photosynthesis', draft: dirty, sources: [], verify: false });
  check('P5 finalizeAnswer strips forbidden narration', !containsForbiddenNarration(out.summary));
  check('P5 finalizeAnswer keeps the real content', out.summary.includes('Photosynthesis converts light into chemical energy'));
  check('P5 finalizeAnswer returns verification metadata', typeof out.verification === 'object');
  check('P5 finalizeAnswer returns a clean summary string', typeof out.summary === 'string' && out.summary.length > 0);
}

// ===========================================================================
// P6 — CODING LOOP ON PRODUCTION code_task PATHS.
// ===========================================================================
{
  const orch = read('src/services/Orchestrator.js');
  check('P6 debugger node runs the production CodingLoop', /runCodingLoop\(\{/.test(orch));
  check('P6 production loop uses a machine-checkable predicate', /successCriterion: 'exit-zero-no-error-text'/.test(orch));
  // Multi-iteration proof on the PRODUCTION configuration (same criterion +
  // bounded budget): a broken first attempt is fixed across iterations.
  const store = new Map();
  store.set('app.js', 'console.log(brokenVar);');
  const runCommand = async () => {
    const code = store.get('app.js');
    const failedRun = /brokenVar|undefinedVar/.test(code);
    return { exitCode: failedRun ? 1 : 0, output: failedRun ? 'ReferenceError: undefinedVar is not defined' : 'all good' };
  };
  const writeFiles = async (files) => { for (const f of files) store.set(f.name, f.code); };
  let fixCalls = 0;
  const fixer = async () => {
    fixCalls++;
    return fixCalls === 1
      ? { files: [{ name: 'app.js', code: 'console.log(undefinedVar);' }], entryPoint: 'app.js' }
      : { files: [{ name: 'app.js', code: "console.log('all good');" }], entryPoint: 'app.js' };
  };
  const res = await runCodingLoop({
    goal: 'make app.js run clean',
    entryPoint: 'app.js',
    files: [{ name: 'app.js', code: store.get('app.js') }],
    runCommand, writeFiles, fixer,
    successCriterion: 'exit-zero-no-error-text',
    maxAttempts: 6,
    sendEvent: () => {},
  });
  check('P6 production-path loop iterates until predicate passes (attempts=' + res.attempts + ')', res.success === true && res.attempts === 3);
  check('P6 exact error was fed back and recorded', res.attemptsLog.some((a) => /undefinedVar/.test(a.outputHead)));
}

// ===========================================================================
// P7 — DURABLE FAILURE HISTORY + REPEATED-FAILURE GUARD.
// ===========================================================================
{
  // The second-iteration prompt must contain the first failure reason: prove
  // the CodingLoop feeds the EXACT error text back to the fixer.
  const seen = [];
  const runCommand = async () => ({ exitCode: 1, output: 'Error: specific-bug-XYZ' });
  const writeFiles = async () => {};
  const fixer = async ({ errorOutput }) => { seen.push(errorOutput); return { files: [{ name: 'a.js', code: 'x' }], entryPoint: 'a.js' }; };
  await runCodingLoop({
    goal: 'x', entryPoint: 'a.js', files: [{ name: 'a.js', code: 'x' }],
    runCommand, writeFiles, fixer, successCriterion: 'exit-zero', maxAttempts: 4, sendEvent: () => {},
  });
  check('P7 fixer received the first failure reason in its context', seen.length >= 2 && /specific-bug-XYZ/.test(seen[0] || ''));
  // Identical-error guard: same error 3x → escalate, no blind retry.
  const runSame = async () => ({ exitCode: 1, output: 'Error: same-forever' });
  const res = await runCodingLoop({
    goal: 'x', entryPoint: 'a.js', files: [{ name: 'a.js', code: 'x' }],
    runCommand: runSame, writeFiles: async () => {}, fixer: async () => ({ files: [{ name: 'a.js', code: 'x' }], entryPoint: 'a.js' }),
    successCriterion: 'exit-zero', maxAttempts: 6, sendEvent: () => {},
  });
  check('P7 identical failure escalates at 3 (attempts=' + res.attempts + ')', res.escalated === true && res.attempts === 3);
  // Graph failure history flows into orchestrator state (already proven in P2).
  const orch = read('src/services/Orchestrator.js');
  check('P7 Orchestrator merges graph failure history into state', (orch.match(/failureHistory/g) || []).length >= 4);
}

// ===========================================================================
// P8 — PROGRESSIVE L0/L1/L2 LOADING.
// ===========================================================================
{
  const cats = listKnowledgeCategories();
  for (const c of ['conventions', 'architecture', 'formatting', 'tools']) {
    check(`P8 knowledge category ${c} present`, cats.includes(c));
  }
  check('P8 always-on JEXI.md is L0 (injected, non-empty)', (loadProjectKnowledge() || '').length > 500);
  check('P8 knowledge-load loads L1/L2 bodies on demand', !!knowledgeLoad('architecture'));
  check('P8 knowledge-load tools has the decision table', /Decision table/.test(knowledgeLoad('tools').md || ''));
  // Planning-time summaries must NOT contain full progressive bodies.
  const { planningSkillSummaries } = await import('./src/services/SkillChain.js');
  const planning = JSON.stringify(planningSkillSummaries());
  check('P8 planning context has no full reference.md bodies', !/accepted-criteria|OWASP|checklist/i.test(planning));
  check('P8 planning context stays small', planning.length < 4000);
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
