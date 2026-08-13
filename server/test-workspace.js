/**
 * Stage 10 (workspace runtime — checkpoints, diffs, rollback) tests.
 * Points WORKSPACE_DIR + DATA_DIR at a temp dir BEFORE importing the modules,
 * so the real workspace and checkpoint store are untouched.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; console.log('✅ ' + name); }
  else { failed++; console.log('❌ ' + name); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-ws-test-'));
process.env.WORKSPACE_DIR = path.join(tmp, 'workspace');
process.env.DATA_DIR = path.join(tmp, 'data');

const { writeWorkspace, readWorkspace, listWorkspace, createCheckpoint, listCheckpoints, diffCheckpoint, rollbackCheckpoint, diffFiles } =
  await import('./src/services/WorkspaceRuntime.js');

/* ---------------- diffFiles (pure) ---------------- */
const d = diffFiles('line1\nline2\nline3', 'line1\nline3\nline4');
check('diffFiles counts added + removed', d.added === 1 && d.removed === 1);
check('diffFiles emits +/- lines', d.lines.some((l) => l.startsWith('+ line4')) && d.lines.some((l) => l.startsWith('- line2')));
check('diffFiles identical → empty', diffFiles('a\nb', 'a\nb').added === 0 && diffFiles('a\nb', 'a\nb').removed === 0);

/* ---------------- write / read / list ---------------- */
const w = writeWorkspace('notes/plan.md', '# Plan\n\nVersion 1\n');
check('writeWorkspace creates the file', w.name === 'notes/plan.md' && w.size > 0);
check('readWorkspace returns content', readWorkspace('notes/plan.md').includes('Version 1'));
check('listWorkspace finds it (recursive)', listWorkspace().some((f) => f.name === 'notes/plan.md'));

let escapeThrew = false;
try { writeWorkspace('../evil.txt', 'nope'); } catch (e) { escapeThrew = true; }
check('path escape rejected', escapeThrew);

/* ---------------- checkpoint → diff → rollback ---------------- */
const cp1 = createCheckpoint('test cp');
check('createCheckpoint returns id + count', Boolean(cp1.id) && cp1.fileCount >= 1);
check('listCheckpoints finds it', listCheckpoints().some((c) => c.id === cp1.id));

writeWorkspace('notes/plan.md', '# Plan\n\nVersion 2 — edited\n\nMore content here\n');
const diffs = diffCheckpoint(cp1.id);
check('diff shows the changed file', diffs.some((f) => f.name === 'notes/plan.md' && (f.added > 0 || f.removed > 0)));

const rolled = rollbackCheckpoint(cp1.id);
check('rollback restores files', rolled.count >= 1);
check('rollback restores content', readWorkspace('notes/plan.md').includes('Version 1'));

/* ---------------- prune keeps the store bounded ---------------- */
for (let i = 0; i < 35; i++) createCheckpoint(`bulk ${i}`);
check('checkpoint store is pruned to 30', listCheckpoints().length <= 30);

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
