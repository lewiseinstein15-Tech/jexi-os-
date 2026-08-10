// Regression test: intent routing must send self-diagnosis queries to self_check,
// never to code_task (previously "errors" matched the coding detector's error regex).
import { planner } from './src/services/Planner.js';

const tests = [
  { q: 'JEXI, run a full system self-check now. Check your health, memory, eyes and recent errors. If anything is wrong, tell me the exact source file and the fix.', expect: 'self_check' },
  { q: 'check yourself', expect: 'self_check' },
  { q: 'are you okay?', expect: 'self_check' },
  { q: 'run a system health check and monitor yourself for any errors', expect: 'self_check' },
  { q: 'Build me a python script that prints hello world', expect: 'code_task' },
  { q: 'fix this code, it has errors and it does not work', expect: 'code_task' },
  { q: 'What is the capital of Kenya?', expect: 'research' },
  { q: 'hello there', expect: 'conversation' },
  { q: 'who are you and who built you?', expect: 'conversation' },
  { q: 'what do you remember about me?', expect: 'memory_query' },
  { q: 'calculate 7 * 6', expect: 'math_solve' },
  // Round-2 specialists (GitHub / Data / DevOps / Docs / Translate / Perf)
  { q: 'push my code to github', expect: 'github' },
  { q: 'commit and push to github', expect: 'github' },
  { q: 'open a pull request for my changes', expect: 'github' },
  { q: 'analyze this csv data and give me stats', expect: 'data' },
  { q: 'make a chart of the sales data', expect: 'data' },
  { q: 'deploy this app to render', expect: 'devops' },
  { q: 'write a readme for this project', expect: 'docs' },
  { q: 'document this code', expect: 'docs' },
  { q: 'translate this text to french', expect: 'translate' },
  { q: 'say hello in swahili', expect: 'translate' },
  { q: 'make my app load faster', expect: 'perf' },
  { q: 'optimize the performance of this site', expect: 'perf' },
  // Guard: building a docs/chart app still routes to the coding team
  { q: 'build a documentation website', expect: 'code_task' },
  { q: 'build a chart generator app', expect: 'code_task' },
  { q: 'build a translation app', expect: 'code_task' },
  // Research-first compounds — "research X, then apply/build Y" plans TWO teams
  // (was previously misrouted into the heavy coding sprint → silent chat).
  { q: 'go research on frontend style layout how it should looks like on GitHub repositories then apply the better one to make it look much coller', expect: 'compound_task' },
  { q: 'research frontend style layout and apply the better one to make it look cooler', expect: 'compound_task' },
  { q: 'study machine learning then build me a quiz app', expect: 'compound_task' },
  { q: 'look up modern pricing and then redesign my landing page', expect: 'compound_task' },
  // Guard: research-first WITHOUT an app/UI deliverable stays in the light
  // pipeline (research, or knowledge_recall when the user's own library already
  // holds the topic — answering from the library is even better than a web search).
  { q: 'go research on x and then apply it', expectAny: ['research', 'knowledge_recall'] },
  { q: 'research how to bake a cake and then make it', expectAny: ['research', 'knowledge_recall'] },
  { q: 'research solar panels and explain how they work', expectAny: ['research', 'knowledge_recall'] },
  { q: 'research the best diet and tell me the top tips', expectAny: ['research', 'knowledge_recall'] },
];

let failures = 0;
for (const t of tests) {
  const p = await planner.analyzeIntent(t.q);
  const ok = t.expectAny ? t.expectAny.includes(p.intent) : p.intent === t.expect;
  const want = t.expectAny ? t.expectAny.join('|') : t.expect;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${(p.intent + '          ').slice(0, 12)} expected ${want.padEnd(14)} <- "${t.q.slice(0, 55)}"`);
}

// Confirmation-resume: when JEXI asks "would you like me to…?" and the user says
// yes, planConfirmed re-plans the ORIGINAL request. A vague personal task
// ("I want to track my water intake") must map to the coding team, while plain
// questions ("tell me about…") must stay research — the word "yes" alone must
// never trigger a re-search.
const confirmTests = [
  { q: 'I want to track my water intake', expect: 'code_task' },
  { q: 'track my expenses', expect: 'code_task' },
  { q: 'I want an app that reminds me to drink water', expect: 'code_task' },
  { q: 'tell me about solar panels', expect: 'learning_research' },
  { q: 'I want to understand quantum physics', expect: 'learning_research' },
  { q: 'what is the capital of Kenya', expect: 'research' },
  // Math topic words alone are NOT a solve request (regression for the trusted-library test)
  { q: 'study calculus', expect: 'study_topic' },
  { q: 'what is calculus', expect: 'research' },
  { q: 'solve this calculus problem', expect: 'math_solve' },
  { q: 'build a dashboard of today\'s news', expect: 'compound_task' },
];
for (const { q, expect } of confirmTests) {
  const p = await planner.planConfirmed(q);
  const ok = p.intent === expect;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${(p.intent + '          ').slice(0, 12)} expected ${expect.padEnd(12)} <- CONFIRM "${q.slice(0, 55)}"`);
}

console.log(failures === 0 ? '\nALL ROUTING TESTS PASSED' : `\n${failures} ROUTING TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
