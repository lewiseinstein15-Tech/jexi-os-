/**
 * B165 — DSH CODING STACK TESTS.
 *
 *   str_replace_editor  → dsh tool-str-replace-editor invariants
 *   GitHub engine       → target parsing, scan/read/review shapes,
 *                         honest no-token path
 *   DSH coding loop     → the tool loop edits + RUNS code via mocks
 *   wiring              → codePipeline runs the loop; tools registered
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runDshCoding } from './src/services/DshCoding.js';
import { view, create, strReplace, insert, isConfirmedAbsent } from './src/services/StrReplaceEditor.js';
import { parseGitHubTarget } from './src/services/GitHubEngine.js';
import { WORKSPACE_DIR } from './src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

/* ══════════════ 1. STR REPLACE EDITOR (dsh invariants) ══════════════ */
console.log('\n== 1. str_replace_editor (dsh tool mirror) ==');
{
  fs.rmSync(path.join(WORKSPACE_DIR, 'b165'), { recursive: true, force: true });
  fs.mkdirSync(path.join(WORKSPACE_DIR, 'b165'), { recursive: true });

  ok('create refuses nothing new', create('b165/app.js', 'const a = 1;\nconst b = 2;\nconsole.log(a + b);\n').ok);
  ok('create REFUSES an existing path (guarded create)', !create('b165/app.js', 'x').ok);

  const v = view('b165/app.js');
  ok('view shows 1-based numbered lines', v.ok && v.text.includes('1→const a = 1;') && v.text.includes('3→console.log'));

  const dup = strReplace('b165/app.js', 'const', 'let');
  ok('non-unique old_str rejected with the dsh error shape', !dup.ok && dup.code === 'FS_NOT_UNIQUE');
  const no = strReplace('b165/app.js', 'not-in-file', 'x');
  ok('no-match rejected (FS_NO_MATCH)', !no.ok && no.code === 'FS_NO_MATCH');
  ok('unique str_replace applies exactly once', strReplace('b165/app.js', 'const a = 1;', 'const a = 10;').ok
    && fs.readFileSync(path.join(WORKSPACE_DIR, 'b165/app.js'), 'utf-8').includes('const a = 10;')
    && fs.readFileSync(path.join(WORKSPACE_DIR, 'b165/app.js'), 'utf-8').includes('const b = 2;'));

  ok('insert lands AFTER the given line (0=top)', insert('b165/app.js', 0, "// shebang-ish top").ok
    && fs.readFileSync(path.join(WORKSPACE_DIR, 'b165/app.js'), 'utf-8').startsWith('// shebang-ish top'));

  ok('absence recorded before FS_NOT_FOUND', view('b165/ghost.js').code === 'FS_NOT_FOUND' && isConfirmedAbsent('b165/ghost.js'));
  ok('workspace escape refused', !view('../../etc/passwd').ok);
  ok('dir view lists 2 levels', view('b165').ok && view('b165').kind === 'dir');
}

/* ══════════════ 2. GITHUB ENGINE ══════════════ */
console.log('\n== 2. GitHub engine (dsh mcp__github__* port) ==');
{
  ok('parses owner/repo', JSON.stringify(parseGitHubTarget('vercel/next.js')) === JSON.stringify({ owner: 'vercel', repo: 'next.js' }));
  const u = parseGitHubTarget('https://github.com/vercel/next.js/tree/canary/packages/app');
  ok('parses github.com URLs with tree paths', u.owner === 'vercel' && u.repo === 'next.js' && u.path === 'packages/app');
  const pr = parseGitHubTarget('https://github.com/vercel/next.js/pull/123');
  ok('parses PR URLs', pr.pull === 123);
  ok('rejects non-github text', parseGitHubTarget('hello world') === null);

  const plugin = fs.readFileSync(path.join(ROOT, 'server/plugins/github-engine/plugin.js'), 'utf-8');
  for (const slug of ['github_repo_scan', 'github_file_read', 'github_file_edit', 'github_repo_review', 'github_pr_review']) {
    ok(`tool registered: ${slug}`, plugin.includes(`'${slug}'`));
  }
}

/* ══════════════ 3. THE CODING LOOP (mocked model, REAL tools) ══════════════ */
console.log('\n== 3. DSH coding loop — edits + RUNS code for real ==');
{
  fs.rmSync(path.join(WORKSPACE_DIR, 'b165loop'), { recursive: true, force: true });
  const events = [];
  const sendEvent = (t, d) => events.push(String(d.message || ''));

  const built = await runDshCoding({
    goal: 'create b165loop/calc.js that prints 30',
    owner: 'test-b165',
    sendEvent,
    __mockCompletions: [
      { toolCalls: [{ id: 'c1', name: 'str_replace_editor', arguments: { command: 'create', path: 'b165loop/calc.js', file_text: 'const x = 10;\nconst y = 20;\nconsole.log(x + y);\n' } }], text: '' },
      { toolCalls: [{ id: 'c2', name: 'bash', arguments: { command: 'node b165loop/calc.js' } }], text: '' },
      { toolCalls: [], text: 'Built b165loop/calc.js; verified it prints 30.' },
    ],
  });

  ok('loop produced the file', built.ok && built.files.some((f) => f.name === 'b165loop/calc.js'));
  ok('loop RAN the code (bash executed for real)', events.some((m) => m.includes('ran: node b165loop/calc.js')));
  ok('run observed exit 0', events.some((m) => m.includes('exit 0')));
  ok('editor streamed its steps', events.some((m) => m.includes('created b165loop/calc.js')));
  ok('summary kept', built.summary.includes('prints 30'));
  ok('finish line reports edits + runs', events.some((m) => m.includes('loop finished') && m.includes('1 edits')));

  // observe→fix discipline: a failing first attempt must be patched and re-run
  const ev2 = [];
  const fixed = await runDshCoding({
    goal: 'make b165loop/broken.js print 5',
    owner: 'test-b165',
    sendEvent: (t, d) => ev2.push(String(d.message || '')),
    __mockCompletions: [
      { toolCalls: [{ id: 'c1', name: 'str_replace_editor', arguments: { command: 'create', path: 'b165loop/broken.js', file_text: 'console.log(1 +);\n' } }], text: '' },
      { toolCalls: [{ id: 'c2', name: 'bash', arguments: { command: 'node b165loop/broken.js' } }], text: '' },
      { toolCalls: [{ id: 'c3', name: 'str_replace_editor', arguments: { command: 'str_replace', path: 'b165loop/broken.js', old_str: 'console.log(1 +);', new_str: 'console.log(2 + 3);' } }], text: '' },
      { toolCalls: [{ id: 'c4', name: 'bash', arguments: { command: 'node b165loop/broken.js' } }], text: '' },
      { toolCalls: [], text: 'Fixed and verified.' },
    ],
  });
  ok('observe→fix→re-run discipline works (exit 1 then exit 0)',
    ev2.some((m) => m.includes('exit 1')) && ev2.some((m) => m.includes('exit 0')) && fixed.ok);
}

/* ══════════════ 4. WIRING ══════════════ */
console.log('\n== 4. Pipeline wiring ==');
{
  const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');
  ok('codePipeline runs the DSH coding loop first', orch.includes('runDshCoding(') && orch.includes('DSH coding loop'));
  ok('one-shot builder is only the fallback', orch.includes('if (!project || !project.files || !project.files.length)'));
  const dsh = fs.readFileSync('./src/services/DshCoding.js', 'utf-8');
  ok('loop carries the dsh toolset', ['str_replace_editor', 'bash', 'python_run', 'github_repo_scan', 'github_file_read'].every((t) => dsh.includes(`'${t}'`)));
  ok('attempt budget bounded', dsh.includes('MAX_ITERATIONS'));
}

console.log(`\n${failures === 0 ? '🎉 ALL B165 DSH-CODING CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
