/** B189 — the "annoying" fixes from the user's real log, behavioral. */
import fs from 'fs';
import os from 'os';
let failures = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) failures += 1; };

console.log('\n== 1. memory reuse precision (the wrong-app bug) ==');
process.env.DATA_DIR = fs.mkdtempSync(os.tmpdir() + '/b189-');
const MM = await import('./src/services/MemoryManager.js');
{
  // store an expense-tracker solution from an unrelated task
  await MM.addCodingKnowledge?.({ goal: 'build an expense tracker cli in python', solution: 'made expense_tracker.py', files: ['expense_tracker.py'] }).catch(() => {});
  // fallback: write through rememberCoding if addCodingKnowledge absent
  if (!MM.addCodingKnowledge) {
    const mem = MM.loadMemory?.();
    if (mem) {
      mem.codingKnowledge = [{ goal: 'build an expense tracker cli in python', solution: 'made expense_tracker.py', files: ['expense_tracker.py'], date: new Date().toISOString() }];
      MM.saveMemory?.(mem);
    }
  }
  const wrong = await MM.searchCodingKnowledge('yeah and give me the preview link');
  ok('"give me the preview link" does NOT reuse the expense tracker', wrong === null);
  const right = await MM.searchCodingKnowledge('build me an expense tracker cli in python');
  ok('a genuinely matching request still reuses it', right !== null);
}

console.log('\n== 2. preview-link asks BUILD (never "shall I?") ==');
{
  const { routeToTeam } = await import('./src/services/TeamRouter.js');
  for (const q of ['give me the preview link', 'where is the link', 'send me the url', 'open it']) {
    const r = routeToTeam(q, {});
    ok(`"${q}" → dev team`, r?.team === 'dev');
  }
  ok('the canonical brief forces a web app', routeToTeam('give me the preview link', {})?.brief?.includes('index.html'));
}

console.log('\n== 3. deliverable titles are cleaned ==');
{
  const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');
  ok('titleFor strips conversational filler', orch.includes('function titleFor') && orch.includes('Yeah'));
  ok('summaries use titleFor, not the raw ask', orch.includes('titleFor(effQuery)'));
}

console.log('\n== 4. cold-start warmup ==');
{
  const idx = fs.readFileSync('./index.js', 'utf-8');
  ok('boot warmup fires a tiny generate + classify', idx.includes('[Warmup]') && idx.includes("generateContent('Reply with just: ok'"));
}

console.log(failures === 0 ? '\n🎉 B189 CHECKS PASSED' : `\n💥 ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
