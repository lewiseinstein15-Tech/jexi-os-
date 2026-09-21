/**
 * JEXI OS — Phase 15 Scope D — append-only audit events.
 *
 * Every GEP action appends { seq, action, geneId?, capsuleId?, at }
 * to <gepDir>/events.jsonl. `at` is a monotonic op counter
 * (op-seq.txt), never a clock — the same operation sequence always
 * produces byte-identical events. Events are never rewritten.
 */
import fs from 'node:fs';
import path from 'node:path';

const eventsFile = (dir) => path.join(dir, 'events.jsonl');
const seqFile = (dir) => path.join(dir, 'op-seq.txt');

function nextOp(dir) {
  let seq = 0;
  try { seq = parseInt(fs.readFileSync(seqFile(dir), 'utf8'), 10) || 0; } catch { seq = 0; }
  seq += 1;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(seqFile(dir), String(seq));
  return seq;
}

export function appendEvent(dir, { action, geneId, capsuleId }) {
  const at = nextOp(dir);
  let seq = 0;
  const f = eventsFile(dir);
  if (fs.existsSync(f)) {
    seq = fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim() !== '').length;
  }
  seq += 1;
  const ev = { seq, action };
  if (geneId !== undefined) ev.geneId = geneId;
  if (capsuleId !== undefined) ev.capsuleId = capsuleId;
  ev.at = at;
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(f, JSON.stringify(ev) + '\n');
  return ev;
}

export function readEvents(dir) {
  const f = eventsFile(dir);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
}
