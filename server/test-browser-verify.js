/**
 * JEXI OS — test suite for browser UI verification + screenshots (roadmap stage 19).
 * Tests the pure snapshot-diff logic and screenshot gallery listing (no live browser needed).
 */
import { hashText, diffSnapshots, DesktopManager } from './src/services/DesktopManager.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log('\n== hashText ==');
ok(typeof hashText('hello') === 'string' && hashText('hello').length > 0, 'hash is a non-empty string');
ok(hashText('hello') === hashText('hello'), 'hash is deterministic');
ok(hashText('hello') !== hashText('hello!'), 'different text → different hash');

console.log('\n== diffSnapshots ==');
const base = { url: 'https://a.com', title: 'A', elementCount: 5, textHash: hashText('aaa'), textLength: 3 };
ok(diffSnapshots(base, { ...base }).changed === false, 'identical snapshots → unchanged');
ok(diffSnapshots(base, { ...base, url: 'https://b.com' }).signals.includes('url'), 'url change detected');
ok(diffSnapshots(base, { ...base, title: 'B' }).signals.includes('title'), 'title change detected');
ok(diffSnapshots(base, { ...base, elementCount: 9 }).signals.includes('elements'), 'element count change detected');
ok(diffSnapshots(base, { ...base, textHash: hashText('bbb') }).signals.includes('text'), 'text change detected');
const multi = diffSnapshots(base, { ...base, url: 'https://b.com', elementCount: 9 });
ok(multi.signals.length === 2 && multi.changed === true, 'multiple signals aggregated');
ok(diffSnapshots(null, { ...base }).changed === true, 'before missing → changed');
ok(diffSnapshots({}, {}).changed === false, 'both missing → unchanged (no crash)');

console.log('\n== Screenshot gallery (fresh DATA_DIR) ==');
const dm = new DesktopManager('test');
const gallery = dm.listScreenshots('test', 12);
ok(Array.isArray(gallery), 'listScreenshots returns an array');
ok(gallery.every((s) => /^shot-.*\.jpg$/.test(s.file)), 'gallery entries are shot-*.jpg');

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
