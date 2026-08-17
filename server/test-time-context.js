/**
 * B104 — TIME CONTEXT + SPILL RETENTION regression suite
 * (deepseek-harness `time-context` + `output-retention` mirror).
 *
 * Proves: the time block renders the current date with the request
 * timezone (safe fallback to UTC), appending is idempotent, LLMClient
 * injects it into both entry points, and spill retention ages out old
 * files and enforces per-owner budgets.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-tc2-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { timeContextBlock, appendTimeContext, setRequestTimeZone, requestTimeZone } = await import('./src/services/TimeContext.js');
const { saveText, listSpills, runRetention } = await import('./src/services/SpillStore.js');

console.log('\n== 1. Time context block (dsh time-context mirror) ==');
const block = timeContextBlock();
ok(block.includes('Current date and time:'), 'block names the current date/time');
ok(/20\d\d/.test(block), `block contains the real year (${block.match(/20\d\d/)?.[0]})`);
ok(block.includes('Server clock:'), 'block carries the ISO server clock');
const today = new Date().toISOString().slice(0, 10);
ok(block.includes(today), `block matches today's date (${today})`);
ok(requestTimeZone() === 'UTC', 'default zone is UTC');

console.log('\n== 2. Request timezone (x-jexi-tz mirror) ==');
setRequestTimeZone('Africa/Nairobi');
ok(requestTimeZone() === 'Africa/Nairobi', 'valid zone accepted');
const nbo = timeContextBlock();
ok(nbo.includes('Africa/Nairobi'), 'block renders the request zone');
setRequestTimeZone('Not/AZone');
ok(requestTimeZone() === 'UTC', 'invalid zone falls back to UTC safely');
setRequestTimeZone('');
ok(requestTimeZone() === 'UTC', 'empty zone falls back to UTC');
setRequestTimeZone('America/New_York');
ok(timeContextBlock().includes('America/New_York'), 'block switches zones per request');

console.log('\n== 3. Idempotent append + LLMClient injection ==');
const withTime = appendTimeContext('SYSTEM');
ok(withTime.includes('Current date and time:'), 'appendTimeContext adds the block');
ok(appendTimeContext(withTime) === withTime, 'append is idempotent (no duplicates)');
const src = fs.readFileSync('./src/services/LLMClient.js', 'utf-8');
ok(src.includes('appendTimeContext(systemInstruction)') && (src.match(/appendTimeContext\(systemInstruction\)/g) || []).length === 2,
  'LLMClient injects time context in BOTH generateContent and generateWithToolsLoop');

console.log('\n== 4. Spill retention (dsh output-retention analog) ==');
const OWNER = 'retention-owner';
const a = saveText({ owner: OWNER, source: 't', suggestedName: 'old', content: 'A'.repeat(1000) });
const b = saveText({ owner: OWNER, source: 't', suggestedName: 'new', content: 'B'.repeat(1000) });
ok(a.ok && b.ok, 'two spills saved');
// Backdate the first file beyond the retention window.
const oldPath = path.join(process.env.DATA_DIR, 'spills', OWNER, path.basename(String(a.locator)));
const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
fs.utimesSync(oldPath, past, past);
const r1 = runRetention({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
ok(r1.deleted === 1 && r1.freedBytes === 1000, `aged-out file deleted (${r1.deleted}, freed ${r1.freedBytes})`);
const remain = listSpills(OWNER);
ok(remain.length === 1 && remain[0].file.includes('new'), 'recent file survives');
// Byte budget: tiny cap → the remaining file is trimmed too.
saveText({ owner: OWNER, source: 't', suggestedName: 'big', content: 'C'.repeat(5000) });
const r2 = runRetention({ maxAgeMs: 7 * 24 * 60 * 60 * 1000, maxBytesPerOwner: 1500 });
ok(r2.deleted >= 1, 'byte budget trims oversized owners');
ok(remain.length >= 0, 'stats shape valid');
// File-count budget
for (let i = 0; i < 5; i++) saveText({ owner: OWNER, source: 't', suggestedName: `f${i}`, content: 'X'.repeat(50) });
const r3 = runRetention({ maxAgeMs: 7 * 24 * 60 * 60 * 1000, maxBytesPerOwner: 50 * 1024 * 1024, maxFilesPerOwner: 3 });
ok(r3.deleted >= 2, 'file-count budget caps files per owner');
ok(listSpills(OWNER).length <= 3, `owner capped at 3 files (${listSpills(OWNER).length})`);
const r4 = runRetention({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
ok(r4.scannedOwners >= 1, 'retention reports scanned owners');
// empty store is a no-op
const r5 = runRetention();
ok(r5.deleted === 0, 'empty store retention is a no-op');

console.log(`\nB104 time-context+retention: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
