/** B186 add-on: junk-file filter + preview link checks (appended runner). */
import fs from 'fs';
let failures = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) failures += 1; };

const dsh = fs.readFileSync('./src/services/DshCoding.js', 'utf-8');
ok('venv/node_modules/lockfiles never reported as deliverables', dsh.includes('SKIP_DIRS') && dsh.includes("'venv'") && dsh.includes('isJunkPath'));
ok('junk filter is module-scope (beforeSet can use it)', dsh.indexOf('const SKIP_DIRS') < dsh.indexOf('function beforeSet'));
const tr = fs.readFileSync('./src/services/TeamRouter.js', 'utf-8');
ok('web builds get a real /preview link', tr.includes('/preview/') && tr.includes('Live preview'));
ok('file list capped at 8 (+N more)', tr.includes('slice(0, 8)'));

// behavioral: venv junk excluded, real file kept (the user's weather-app bug)
process.env.DATA_DIR = '/tmp/b186t-' + Date.now();
process.env.WORKSPACE_DIR = process.env.DATA_DIR + '/ws'; // isolated: the shared workspace has stale state
const { WORKSPACE_DIR } = await import('./src/config.js');
import fsm from 'fs';
fsm.mkdirSync(WORKSPACE_DIR, { recursive: true });
const { runDshCoding } = await import('./src/services/DshCoding.js');
const r = await runDshCoding({
  goal: 'app', owner: 't', sendEvent: () => {},
  __mockCompletions: [
    { toolCalls: [{ id: '1', name: 'bash', arguments: { command: 'mkdir -p venv/bin && touch venv/bin/activate venv/pyvenv.cfg' } }], text: '' },
    { toolCalls: [{ id: '2', name: 'str_replace_editor', arguments: { command: 'create', path: 'app.py', file_text: 'print(1)' } }], text: '' },
    { toolCalls: [], text: 'done' },
  ],
});
ok(`deliverables = [${r.files.map((f) => f.name)}] — junk-free`, r.files.length === 1 && r.files[0].name === 'app.py');

console.log(failures === 0 ? '🎉 B186 CHECKS PASSED' : `💥 ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
