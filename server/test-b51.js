// B51 — KILL NARRATION, ENFORCE TOOL DISCIPLINE, HARDEN GRAPH+LOOP.
// Proves each priority from FIXLOG-B51.md with machine-checkable assertions:
//  P1  process narration cannot reach final output (sanitizer + source)
//  P2  simple definitional questions route to direct_answer (no web/study)
//  P3  tool-selection discipline: decision table loadable, direct answers plan
//      zero web/browser/search agents, heavy intents keep their agents
//  P4  no unverified result ships: directAnswer + studyTopic run verification
//  P5  correction paths: coding loop escalates on identical repeated errors
//      instead of blind re-fixing; research re-enters with specific claims
//  P6  B50 knowledge/skills locked: progressive folders present and loadable
//  P7  sanitizer end-to-end: dirty answer → clean; legitimate content untouched
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { planner, TEAM_PLAN } from './src/services/Planner.js';
import { runCodingLoop } from './src/services/CodingLoop.js';
import {
  sanitizeFinalAnswer,
  containsForbiddenNarration,
  FORBIDDEN_NARRATION_PATTERNS,
} from './src/services/AnswerSanitizer.js';
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

// ---------------------------------------------------------------------------
// P1 + P7 — process narration is dead.
// ---------------------------------------------------------------------------
{
  const dirty = `### 📚 JEXI SCHOLAR

I studied **Photosynthesis** using the Trusted Library (Wikipedia, Project Gutenberg, arXiv, Open Library) and saved it to my knowledge library.

## Photosynthesis
Photosynthesis converts light energy into chemical energy.`;

  const clean = sanitizeFinalAnswer(dirty);
  check('P1 sanitizer removes the JEXI SCHOLAR header + narration paragraph', !containsForbiddenNarration(clean));
  check('P1 real content survives the sanitizer', clean.includes('Photosynthesis converts light energy into chemical energy'));
  check('P1 no "studied" narration survives', !/I studied/i.test(clean));
  check('P1 no "Trusted Library" narration survives', !/Trusted Library/i.test(clean));
  check('P1 no "saved it to my knowledge library" survives', !/knowledge library/i.test(clean));

  const dirty2 = `### 🧠 JEXI OS — FROM MEMORY

I remember this from memory: your favorite color is green.

## The answer
Green.`;

  const clean2 = sanitizeFinalAnswer(dirty2);
  check('P1 FROM MEMORY header stripped', !/FROM MEMORY/i.test(clean2));
  check('P1 "I remember this from memory" stripped', !/I remember this from memory/i.test(clean2));
  check('P1 answer content kept', clean2.includes('## The answer'));

  const dirty3 = `### 💻 JEXI TEAM — PLANNED, BUILT, TESTED & SHIPPED

✅ The full agent team worked together: planned, wrote, ran, QA-tested.

## Result
Working app. I solved this before, so here is the verified solution.`;
  const clean3 = sanitizeFinalAnswer(dirty3);
  check('P1 JEXI TEAM banner stripped', !/JEXI TEAM/i.test(clean3));
  check('P1 "full agent team worked together" stripped', !/full agent team worked together/i.test(clean3));
  check('P1 "I solved this before" stripped', !/I solved this before/i.test(clean3));

  check('P7 sanitizer strips "as an AI"', !containsForbiddenNarration(sanitizeFinalAnswer('As an AI, I cannot do that.')));
  check('P7 sanitizer strips "I will now"', !containsForbiddenNarration(sanitizeFinalAnswer('I will now build the app.')));

  const legit = 'Photosynthesis converts light into chemical energy. The Calvin cycle fixes CO2 into sugars.';
  check('P7 legitimate content is unchanged', sanitizeFinalAnswer(legit) === legit);

  check('P7 containsForbiddenNarration detects a dirty answer', containsForbiddenNarration(dirty));
  check('P7 containsForbiddenNarration is clean for legit content', !containsForbiddenNarration(legit));
  check('P7 forbidden-pattern list is populated', FORBIDDEN_NARRATION_PATTERNS.length >= 15);
}

// P1 — the Orchestrator source no longer builds narration headers anywhere.
{
  const src = read('src/services/Orchestrator.js');
  check('P1 Orchestrator has no JEXI SCHOLAR header', !src.includes('JEXI SCHOLAR'));
  check('P1 Orchestrator no longer builds the FROM YOUR BOOKS header', !src.includes('JEXI OS — FROM YOUR BOOKS\n') && src.includes('## ${top.title}'));
  check('P1 Orchestrator has no JEXI TEAM — PLANNED banner', !src.includes('JEXI TEAM — PLANNED'));
  check('P1 Orchestrator has no "I studied **" narration', !src.includes('I studied **'));
  check('P1 sanitizer wired into responder', src.includes("sanitizeFinalAnswer(results.summary)"));
}

// ---------------------------------------------------------------------------
// P2 — simple definitional questions get DIRECT answers (no web/study).
// ---------------------------------------------------------------------------
{
  const p1 = await planner.analyzeIntent('what is the capital of kenya');
  const p2 = await planner.analyzeIntent('who is albert einstein');
  const p3 = await planner.analyzeIntent('what is the meaning of life');
  check('P2 "what is the capital of kenya" → direct_answer (got ' + p1.intent + ')', p1.intent === 'direct_answer');
  check('P2 "who is albert einstein" → direct_answer (got ' + p2.intent + ')', p2.intent === 'direct_answer');
  check('P2 "what is the meaning of life" → direct_answer (got ' + p3.intent + ')', p3.intent === 'direct_answer');

  // Explicit learning still goes to study — the direct-answer shortcut must
  // NOT swallow "study X" (wantsLearning guard).
  const study = await planner.analyzeIntent('study computer science for my exam');
  check('P2 "study computer science for my exam" is NOT direct_answer (got ' + study.intent + ')', study.intent !== 'direct_answer');

  const src = read('src/services/Orchestrator.js');
  check('P2 router maps direct_answer → directAnswer node', /case 'direct_answer': return 'directAnswer'/.test(src));
  check('P2 directAnswer node exists in the graph', /N\.directAnswer = this\.wrapCase\('directAnswer'/.test(src));
}

// ---------------------------------------------------------------------------
// P3 — tool-selection discipline.
// ---------------------------------------------------------------------------
{
  check('P3 direct_answer team plans ZERO web/browser/search agents', !TEAM_PLAN.direct_answer.some((a) => /searcher|navigator|query-analyzer|browser|extractor|synthesizer|reranker/i.test(a)));
  check('P3 direct_answer team is minimal (2 agents)', TEAM_PLAN.direct_answer.length === 2);
  check('P3 research still attaches the search team', TEAM_PLAN.research.includes('searcher') && TEAM_PLAN.research.includes('synthesizer'));
  check('P3 study_topic still attaches the scholar', TEAM_PLAN.study_topic.includes('scholar'));

  const tools = knowledgeLoad('tools');
  check('P3 knowledge-load tools returns the decision table', !!tools && /Decision table/.test(tools.md));
  check('P3 decision table forbids web for "what is X"', /Simple definition \/ "what is X"/.test(tools.md) && /Do NOT use[\s\S]*Web search/.test(tools.md));
  check('P3 JEXI.md carries the tool-discipline rule', /Tool discipline/.test(loadProjectKnowledge()));
}

// ---------------------------------------------------------------------------
// P4 — NO UNVERIFIED RESULT → FINAL OUTPUT.
// ---------------------------------------------------------------------------
{
  const src = read('src/services/Orchestrator.js');
  check('P4 directAnswer draft runs through verification', /N\.directAnswer[\s\S]{0,4000}verifyAnswer/.test(src));
  check('P4 research retry feeds specific missing claims', src.includes('retryWithClaims'));
}

// ---------------------------------------------------------------------------
// P5 — correction paths + repeated-failure behaviour.
// ---------------------------------------------------------------------------
{
  // The SAME exact error three times in a row → escalate, never blind re-fix.
  const runCommand = async () => ({ exitCode: 1, output: 'ReferenceError: brokenVar is not defined\n    at buggy.js:1:13' });
  const writeFiles = async () => {};
  let fixCalls = 0;
  const fixer = async () => { fixCalls++; return { files: [{ name: 'buggy.js', code: 'console.log(brokenVar);' }], entryPoint: 'buggy.js' }; };

  const res = await runCodingLoop({
    goal: 'make buggy.js print DONE',
    entryPoint: 'buggy.js',
    files: [{ name: 'buggy.js', code: 'console.log(brokenVar);' }],
    runCommand, writeFiles, fixer,
    successCriterion: 'exit-zero',
    maxAttempts: 6,
    sendEvent: () => {},
  });

  check('P5 identical-error guard escalates instead of blind re-fixing (escalated=' + res.escalated + ')', res.escalated === true);
  check('P5 escalation happens at 3 identical attempts (attempts=' + res.attempts + ')', res.attempts === 3);
  check('P5 escalation reports failure', res.success === false);
  check('P5 escalation records the repeated error', !!res.repeatedError && /brokenVar/.test(res.repeatedError));
  check('P5 fixer was NOT allowed to loop forever (fixCalls=' + fixCalls + ')', fixCalls === 2);

  const src = read('src/services/Orchestrator.js');
  check('P5 research re-enters itself with specific claims on retry', src.includes("state.outcome = 'retry'") && src.includes('state.context.retryWithClaims'));
  const loopSrc = read('src/services/CodingLoop.js');
  check('P5 CodingLoop carries the identical-streak guard', /IDENTICAL_STREAK = 3/.test(loopSrc));
}

// ---------------------------------------------------------------------------
// P6 — B50 progressive knowledge + skills locked.
// ---------------------------------------------------------------------------
{
  const cats = listKnowledgeCategories();
  check('P6 knowledge categories include conventions', cats.includes('conventions'));
  check('P6 knowledge categories include architecture', cats.includes('architecture'));
  check('P6 knowledge categories include formatting', cats.includes('formatting'));
  check('P6 knowledge categories include tools', cats.includes('tools'));

  check('P6 knowledge-load conventions returns content', !!knowledgeLoad('conventions'));
  check('P6 knowledge-load architecture returns content', !!knowledgeLoad('architecture'));
  check('P6 knowledge-load formatting returns the voice rules', !!knowledgeLoad('formatting') && /VOICE & GARBAGE RULES/.test(knowledgeLoad('formatting').md));

  check('P6 always-on JEXI.md is injected (non-empty)', (loadProjectKnowledge() || '').length > 500);
  check('P6 JEXI.md carries the never-narrate rule', /NEVER narrate process to the user/.test(loadProjectKnowledge()));
  check('P6 formatting knowledge forbids narration', /process narration/i.test(knowledgeLoad('formatting').md));
}

// ---------------------------------------------------------------------------
// Final report.
// ---------------------------------------------------------------------------
console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
