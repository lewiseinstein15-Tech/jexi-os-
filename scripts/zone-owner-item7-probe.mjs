#!/usr/bin/env node
/**
 * ZONE-OWNER ITEM 7 LIVE PROBE — test-hud.js "first publish bumps revision
 * to 1" standing failure. Diagnosis: producer-side race — the 120ms
 * schedulePublish debounce fired DURING the manual publish's `await build()`
 * (build observed >1.4s on cold subsystem scans), so two publishes
 * interleaved and the first manual publish returned revision 2.
 * Fix: publish() cancels the pending debounce (it IS the coalescing point);
 * _reset() clears stale timers. The ASSERT was right; the producer was wrong.
 * Run from repo root:  node scripts/zone-owner-item7-probe.mjs
 */
import {
  _resetProducer, noteToolPending, recordToolCall, publish, snapshot,
} from '../runtime/events/hud/index.js';

const DEBOUNCE_MS = 120; // producer.js constant
const WAIT = 400;        // > 3× debounce
let fails = 0; let checks = 0;
const check = (label, cond, detail = '') => {
  checks++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 1. the exact failing test scenario, now deterministic
{
  _resetProducer();
  noteToolPending({ id: 'p1', name: 'fs.read' }, {});
  recordToolCall({ id: 'p1', name: 'fs.read' }, { ok: true, durationMs: 42 }, {});
  const t0 = Date.now();
  const pub1 = await publish('test-1');
  const buildMs = Date.now() - t0;
  console.log(`  evidence: build+publish took ${buildMs}ms (debounce window is ${DEBOUNCE_MS}ms — ${buildMs > DEBOUNCE_MS ? 'the race window WAS live in this run' : 'fast build this run'})`);
  check('first publish → { changed: true, revision: 1 } (the test-hud.js assert, verbatim)',
    pub1.changed === true && pub1.revision === 1,
    `changed=${pub1.changed} revision=${pub1.revision} buildMs=${buildMs}`);
}

// ---- 2. debounce still coalesces a burst into ONE scheduled publish
{
  _resetProducer();
  recordToolCall({ id: 'b1', name: 'fs.read' }, { ok: true, durationMs: 5 }, {});
  recordToolCall({ id: 'b2', name: 'fs.read' }, { ok: true, durationMs: 5 }, {});
  recordToolCall({ id: 'b3', name: 'fs.read' }, { ok: true, durationMs: 5 }, {});
  check('burst scheduled but NOT yet published (debounce holds)', snapshot().revision === 0, `revision=${snapshot().revision}`);
  await sleep(WAIT);
  check('burst → exactly ONE debounced publish after the window (coalescing intact)',
    snapshot().revision === 1 && snapshot().payload !== null,
    `revision=${snapshot().revision} reason=${snapshot().reason}`);
}

// ---- 3. manual publish CANCELS the pending debounce (no duplicate revision)
{
  _resetProducer();
  recordToolCall({ id: 'c1', name: 'fs.read' }, { ok: true, durationMs: 5 }, {}); // schedules +120ms
  const pub = await publish('manual-wins');                                        // must cancel it
  const revAfterManual = snapshot().revision;
  await sleep(WAIT);                                                               // window passes
  check('manual publish cancels the pending debounce → revision stays 1 after the window',
    pub.revision === 1 && revAfterManual === 1 && snapshot().revision === 1,
    `pub.revision=${pub.revision} afterWindow=${snapshot().revision}`);
}

// ---- 4. _reset clears a stale timer (no fire into fresh state)
{
  _resetProducer();
  recordToolCall({ id: 'd1', name: 'fs.read' }, { ok: true, durationMs: 5 }, {}); // timer armed
  _resetProducer();                                                               // reset must disarm it
  await sleep(WAIT);
  const s = snapshot();
  check('_reset() disarms the stale debounce → fresh state stays untouched (revision 0, payload null)',
    s.revision === 0 && s.payload === null,
    `revision=${s.revision} payload=${s.payload === null ? 'null' : 'SET'}`);
}

console.log(`\n===== PROBE TALLY: ${checks} checked, ${checks - fails} pass, ${fails} fail =====`);
process.exit(fails === 0 ? 0 : 1);
