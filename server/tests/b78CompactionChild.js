/**
 * B78 fixture — token-threshold compaction, run as a FRESH process so
 * JEXI_COMPACTION_TOKENS + DATA_DIR are read at import time.
 *
 * Usage:
 *   JEXI_COMPACTION_TOKENS=2000 DATA_DIR=<tmp> node tests/b78CompactionChild.js short <gen-marker-file>
 *   JEXI_COMPACTION_TOKENS=2000 DATA_DIR=<tmp> node tests/b78CompactionChild.js long
 *   JEXI_COMPACTION_TOKENS=2000 DATA_DIR=<tmp> node tests/b78CompactionChild.js force
 *
 * short — a few short turns (well under the token ceiling): must NOT compact
 *         and must NOT touch the LLM seam (marker file must stay absent).
 * long  — ~9,000 chars of turns (≈2,250 est tokens > 2,000): MUST compact and
 *         log a context_compaction event with trigger: token_threshold.
 * force — force:true: MUST compact regardless of size and log the event with
 *         trigger: manual.
 */
import fs from 'fs';
import { addChat, getRollingSummary, rollingConversationSummary } from '../src/services/MemoryManager.js';
import { getEvents } from '../src/services/EventLog.js';

const mode = process.argv[2];
const markerFile = process.argv[3] || '';
const result = { mode };

if (mode === 'short') {
  for (let i = 0; i < 5; i++) addChat('user', `short message ${i} about the weather today.`);
  result.before = getRollingSummary();
  result.after = await rollingConversationSummary({
    __generate: async () => { if (markerFile) fs.writeFileSync(markerFile, 'called'); return 'MUST NOT HAPPEN'; },
  });
  result.markerWritten = markerFile ? fs.existsSync(markerFile) : false;
  result.compactionEvents = getEvents({ type: 'context_compaction' }).length;
} else if (mode === 'long') {
  // 40 turns × ~225 chars ≈ 9,000 chars ≈ 2,250 estimated tokens > 2,000.
  for (let i = 0; i < 40; i++) addChat('user', `turn ${i}: ${'y'.repeat(220)}`);
  result.summary = await rollingConversationSummary({ __generate: async () => 'Long conversation summary marker.' });
  const evs = getEvents({ type: 'context_compaction' });
  result.compactionEvents = evs.length;
  result.event = evs[evs.length - 1] || null;
} else if (mode === 'force') {
  // Enough turns to leave something outside the recent verbatim window (15 - 12 = 3).
  for (let i = 0; i < 15; i++) addChat('user', 'short');
  result.summary = await rollingConversationSummary({ force: true, __generate: async () => 'Forced summary marker.' });
  const evs = getEvents({ type: 'context_compaction' });
  result.compactionEvents = evs.length;
  result.event = evs[evs.length - 1] || null;
}

console.log(JSON.stringify(result));
process.exit(0);
