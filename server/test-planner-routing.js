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
];

let failures = 0;
for (const { q, expect } of tests) {
  const p = await planner.analyzeIntent(q);
  const ok = p.intent === expect;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${(p.intent + '          ').slice(0, 12)} expected ${expect.padEnd(12)} <- "${q.slice(0, 55)}"`);
}
console.log(failures === 0 ? '\nALL ROUTING TESTS PASSED' : `\n${failures} ROUTING TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
