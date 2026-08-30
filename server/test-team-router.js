/**
 * B183 — TEAM ROUTER + TONE + STREAMING tests.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) failures += 1; };

/* 1. routing */
console.log('\n== 1. Nova dispatcher routes real chat to the team ==');
{
  const { routeToTeam } = await import('./src/services/TeamRouter.js');
  const cases = [
    ['build me a todo app with react', 'dev'],
    ['fix the bug in my login page', 'dev'],
    ['research the best electric cars in kenya', 'research'],
    ['compare python and rust for backend', 'research'],
    ['every morning at 8am give me AI news', 'scheduler'],
    ['check the news daily', 'scheduler'],
    ['hello there', null],
    ['what is 2+2', null],
    ['who are you', null],
  ];
  for (const [q, want] of cases) {
    const got = routeToTeam(q, {})?.team || null;
    ok(`"${q.slice(0, 38)}" → ${got ?? 'normal'}`, got === want);
  }
  const idx = fs.readFileSync('./index.js', 'utf-8');
  ok('chat pipeline dispatches through Nova before the heavy pipeline', idx.includes("B183 — NOVA'S DISPATCHER") && idx.includes('routeToTeam(raw'));
  ok('team failures fall through to the standard pipeline (never blocks chat)', idx.includes('team lane returned no result'));
  ok('dispatcher does NOT touch `plan` before its declaration (live B183 crash)', !idx.includes('routeToTeam(raw, plan'));
}

/* 2. scheduler lane end-to-end (real job created) */
console.log('\n== 2. scheduler lane creates a real recurring job ==');
{
  const os = await import('os');
  process.env.DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'b183-'));
  const { runTeam } = await import('./src/services/TeamRouter.js');
  const summary = await runTeam('scheduler', 'every morning at 8am give me AI news', { sendEvent: () => {} });
  ok('Tari schedules with a friendly confirmation', /Scheduled/.test(summary) && /8:00/.test(summary));
  ok('mentions unattended delivery + /agents visibility', summary.includes('/agents'));
}

/* 3. tone */
console.log('\n== 3. natural tone rule ==');
{
  const rules = fs.readFileSync('./src/services/Formatting.js', 'utf-8');
  ok('FORMAT_RULES: short replies = plain sentences, no headings', rules.includes('NATURAL TONE') && rules.includes('NO heading'));
  ok('never titles replies with what the user asked', rules.includes('Never title a reply'));
}

/* 4. streaming upgrade */
console.log('\n== 4. streaming upgrade ==');
{
  const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf-8');
  ok('think row breathes while working', css.includes('jx-breathe'));
  ok('caret glows', css.includes('box-shadow: 0 0 10px'));
  ok('streaming text fades in softly', css.includes('jx-fadein'));
  const chat = fs.readFileSync(path.join(ROOT, 'src/components/ChatWindow.jsx'), 'utf-8');
  ok('writer badge pulses while a coworker types', chat.includes('jx-writer') && chat.includes('className="dot"'));
}

console.log(`\n${failures === 0 ? '🎉 ALL B183 CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
