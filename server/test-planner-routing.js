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
  // B51 P2 — simple factual questions answer directly, no web/study pipeline.
  { q: 'What is the capital of Kenya?', expect: 'direct_answer' },
  { q: 'define photosynthesis', expect: 'domain:biology' },
  { q: 'who is albert einstein', expect: 'direct_answer' },
  { q: 'what is the meaning of life', expect: 'direct_answer' },
  { q: 'what does the standard deviation tell us', expect: 'domain:statistics' },
  { q: 'hello there', expect: 'conversation' },
  { q: 'who are you and who built you?', expect: 'conversation' },
  { q: 'what do you remember about me?', expect: 'memory_query' },
  { q: 'calculate 7 * 6', expect: 'math_solve' },
  { q: 'what is calculus', expect: 'domain:mathematics' },
  // Guard: the math detector must NOT match substrings of ordinary words —
  // "comPUTEr" tripped /compute/ and "reSOLVEd" tripped /solve/, sending
  // computer-science questions to the math team. Since B50 the academic
  // DomainRegistry routes CS questions to the computer-science specialist
  // team — even better than the old generic fallback.
  { q: 'give me a roadmap for a beginner in computer science', expect: 'domain:computer-science' },
  { q: 'how do computers work', expect: 'learning_research' },
  { q: 'what is computer science', expect: 'domain:computer-science' },
  { q: 'I resolved this issue with my code', expect: 'code_task' },
  { q: 'compute 5 plus 7', expect: 'math_solve' },
  { q: 'solve for x in 2x + 5 = 13', expect: 'math_solve' },
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
  { q: 'research solar panels and explain how they work', expect: 'research' }, // B52 P3 — explicit "research" beats field routing
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
  // B52 P3 — explicit "research" language routes to the RESEARCH pipeline;
  // the domain router yields to strong research cues.
  { q: 'research solar panels and explain how they work', expect: 'research' },
  { q: 'tell me about solar panels', expect: 'domain:energy-engineering' },
  { q: 'I want to understand quantum physics', expect: 'domain:physics' },
  { q: 'what is the capital of Kenya', expect: 'direct_answer' },
  // Math topic words alone are NOT a solve request (regression for the trusted-library test)
  { q: 'study calculus', expect: 'study_topic' },
  { q: 'what is calculus', expect: 'domain:mathematics' },
  { q: 'solve this calculus problem', expect: 'math_solve' },
  { q: 'build a dashboard of today\'s news', expect: 'compound_task' },
];
for (const { q, expect } of confirmTests) {
  const p = await planner.planConfirmed(q);
  const ok = p.intent === expect;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${(p.intent + '          ').slice(0, 12)} expected ${expect.padEnd(12)} <- CONFIRM "${q.slice(0, 55)}"`);
}

// Identity & origin questions MUST route to conversation (not web search) —
// JEXI has to know her own name, creator and origin.
const identityTests = [
  'what is your name',
  "what's your name",
  'your name',
  'who are you',
  'what are you',
  'who built you',
  'who made you',
  'who created you',
  'who programmed you',
  'who is your creator',
  'your origin',
  'where are you from',
  'where do you come from',
  'where were you created',
  'are you a robot',
  'are you an AI',
  'are you a human',
  'what are you made of',
  'introduce yourself',
  'tell me about yourself',
  'hey JEXI, what is your name',
  'hello, who built you',
  'so who made you?',
];
for (const q of identityTests) {
  const p = await planner.analyzeIntent(q);
  const ok = p.intent === 'conversation';
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${(p.intent + '          ').slice(0, 12)} expected conversation  <- IDENTITY "${q.slice(0, 45)}"`);
}

// Browsing/computer-use language MUST drive the VISIBLE desktop browser
// ("browse the internet" previously fell into the invisible fetch-based
// research path, leaving the Virtual Desktop stuck on the welcome screen).
const computerUseTests = [
  { q: 'browse the internet', expect: 'computer_use' },
  { q: 'browse the web', expect: 'computer_use' },
  { q: 'surf the internet', expect: 'computer_use' },
  { q: 'open the browser', expect: 'computer_use' },
  { q: 'open a browser', expect: 'computer_use' },
  { q: 'look up React hooks in the browser', expect: 'computer_use' },
  { q: 'use the browser to find the best laptop', expect: 'computer_use' },
  { q: 'search for cheap flights on the internet', expect: 'computer_use' },
  { q: 'go to youtube', expect: 'computer_use' },
  { q: 'scroll down on this website', expect: 'computer_use' },
];
for (const { q, expect } of computerUseTests) {
  const p = await planner.analyzeIntent(q);
  const ok = p.intent === expect;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${(p.intent + '          ').slice(0, 12)} expected ${expect.padEnd(12)} <- BROWSER "${q.slice(0, 45)}"`);
}

// ...but plain research and coding must NOT grab the visible browser.
const notComputerUseTests = [
  // B52 P3 — explicit research/current-events cues route to RESEARCH, not a
  // direct field answer (the domain matcher yields to strong research cues).
  { q: 'search the internet for quantum computing news', expect: 'research' },
  // B51 P2 — direct answer (no browser), matching the block's name/intent.
  { q: 'what is the capital of France', expect: 'direct_answer' },
  { q: 'build me a browser game', expect: 'code_task' },
];
for (const { q, expect } of notComputerUseTests) {
  const p = await planner.analyzeIntent(q);
  const ok = p.intent === expect;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${(p.intent + '          ').slice(0, 12)} expected ${expect.padEnd(12)} <- NOT-BROWSER "${q.slice(0, 45)}"`);
}

// AUTONOMOUS ACTION — a personal task phrased as a want/need without a build
// verb must be BUILT directly (JEXI acts by herself, never offers "want me
// to?"), while learning/news/research wants stay on their own tracks.
const autonomousTests = [
  { q: 'I want to track my water intake', expect: 'code_task' },
  { q: 'I need a todo list', expect: 'code_task' },
  { q: 'remind me to drink water every hour', expect: 'code_task' },
  { q: 'I want a calorie counter app', expect: 'code_task' },
  { q: 'manage my monthly budget', expect: 'code_task' },
  { q: 'I want to learn about quantum physics', expect: 'domain:physics' },
  { q: 'I want the latest news on AI', expect: 'news_latest' },
  { q: 'I want to find out about black holes', expect: 'domain:astrophysics' },
  { q: 'tell me about the moon', expect: 'learning_research' },
  // Travel/booking — real-world actions route to the browser team, not research.
  { q: 'book me a flight to Mombasa', expect: 'travel_booking' },
  { q: 'book a hotel in Nairobi for next weekend', expect: 'travel_booking' },
  { q: 'book us a table at an Italian restaurant', expect: 'travel_booking' },
  { q: 'reserve a flight ticket to London', expect: 'travel_booking' },
  { q: 'plan my vacation to Zanzibar', expect: 'travel_booking' },
];
for (const { q, expect } of autonomousTests) {
  const p = await planner.analyzeIntent(q);
  const ok = p.intent === expect;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${(p.intent + '          ').slice(0, 12)} expected ${expect.padEnd(12)} <- AUTONOMOUS "${q.slice(0, 45)}"`);
}

console.log(failures === 0 ? '\nALL ROUTING TESTS PASSED' : `\n${failures} ROUTING TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
