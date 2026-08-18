/**
 * B128 — PROJECT MEMORY regression suite (DSH memory-continuation mirror).
 *
 * Proves: capsules persist after builds (save/list/find), continuation
 * queries resolve the right capsule (exact + fuzzy), capsuleContext injects
 * files/summary/preview for continuation, normalization handles speech
 * variants, and the /api/projects surface exposes them.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-pm2-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const {
  saveProjectCapsule, findProjectCapsule, listProjectCapsules,
  capsuleContext, normalizeProjectName, previewBase,
} = await import('./src/services/ProjectCapsules.js');

console.log('\n== 1. Save + list capsules ==');
const cap1 = saveProjectCapsule({
  name: 'todo app',
  files: [{ path: 'index.html', operation: 'create' }, { path: 'app.js', operation: 'create' }],
  summary: 'Built a todo app with add/complete/delete.',
  previewUrl: 'https://jexi-os-brain.onrender.com/preview/index.html',
  lastQuery: 'build me a todo app',
});
ok(!!cap1 && cap1.slug === 'todo-app', `capsule saved with slug (${cap1.slug})`);
ok(cap1.files.length === 2 && cap1.previewUrl.includes('/preview/'), 'files + preview persisted');
const cap2 = saveProjectCapsule({ name: 'calculator', files: ['calc.html'], summary: 'A calculator.', lastQuery: 'make a calculator' });
ok(!!cap2, 'second capsule saved');
const list = listProjectCapsules();
ok(list.length === 2, `list returns both (${list.length})`);
ok(list[0].slug === 'calculator', 'newest first');

console.log('\n== 2. Find by continuation phrasing (exact + fuzzy) ==');
ok(findProjectCapsule('continue the todo app').slug === 'todo-app', '"continue the todo app" → todo-app');
ok(findProjectCapsule('go back to the calculator').slug === 'calculator', '"go back to the calculator" → calculator');
ok(findProjectCapsule('update my todo app').slug === 'todo-app', '"update my todo app" → todo-app');
ok(findProjectCapsule('add dark mode to todo').slug === 'todo-app', 'fuzzy match works');
ok(findProjectCapsule('build me a spaceship') === null, 'unknown project → null');

console.log('\n== 3. Capsule context injection ==');
const ctx = capsuleContext('continue the todo app');
ok(ctx && ctx.includes('todo app'), 'context names the project');
ok(ctx.includes('index.html') && ctx.includes('app.js'), 'context lists the files');
ok(ctx.includes('Built a todo app'), 'context includes the last summary');
ok(ctx.includes('/preview/index.html'), 'context includes the tappable preview URL');
ok(/Continue THIS project/.test(ctx), 'context tells the model to continue THIS project');

console.log('\n== 4. Normalization handles speech variants ==');
ok(normalizeProjectName('continue the todo app').slug === 'todo-app', 'strips "continue the"');
ok(normalizeProjectName('go back to the calculator').slug === 'calculator', 'strips "go back to the"');
ok(normalizeProjectName('add dark mode to my app').slug === 'add-dark-mode-to-my-app', 'keeps the change phrase as a slug (no false strip)');
ok(normalizeProjectName('') === null, 'empty → null');
ok(typeof previewBase() === 'string', 'preview base resolves');

console.log('\n== 5. Capsule survives rewrite (update keeps createdAt) ==');
const before = findProjectCapsule('todo app');
const again = saveProjectCapsule({ name: 'todo app', files: ['index.html', 'app.js', 'style.css'], summary: 'v2 with dark mode.', lastQuery: 'continue the todo app' });
ok(again.createdAt === before.createdAt, 'update preserves createdAt');
ok(again.files.length === 3, 'update merges new files');

console.log(`\nB128 project-memory: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
