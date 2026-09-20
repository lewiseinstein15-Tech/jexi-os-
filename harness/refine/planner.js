import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { failure } from '../state/journal.js';

export function plan(trajectoryId, { state, trajectoryDirectory }) {
  let file;
  if (!trajectoryId) {
    let files;
    try { files = fs.readdirSync(trajectoryDirectory).filter(f => f.endsWith('.json')).sort(); }
    catch (e) { if (e.code === 'ENOENT') throw failure('E_NO_EVIDENCE'); throw e; }
    file = files.map(f => path.join(trajectoryDirectory, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs || a.localeCompare(b))[0];
    if (!file) throw failure('E_NO_EVIDENCE');
  } else {
    if (typeof trajectoryId !== 'string') throw failure('E_TRAJECTORY_ID');
    file = trajectoryId.endsWith('.json') ? path.resolve(trajectoryId) : path.join(trajectoryDirectory, `${encodeURIComponent(trajectoryId)}.json`);
  }
  const trajectory = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof trajectory.id !== 'string' || !Array.isArray(trajectory.events)) throw failure('E_TRAJECTORY_SCHEMA');
  const matches = trajectory.events.map((event, index) => ({ event, index })).filter(({ event }) => event.kind === 'user_correction' && typeof event.detail === 'string' && event.detail.trim() && typeof event.at === 'string' && Number.isFinite(Date.parse(event.at)));
  if (!matches.length) throw failure('E_NO_EVIDENCE');
  // Never reinterpret a request to change the constitution as a supplemental note.
  if (matches.some(({ event }) => /base[\s_-]*prompt|constitutional|harness\/immutable/i.test(event.detail) || event.collection === 'base-prompt')) state.basePrompt.refuse('refine trajectory');
  const { event, index } = matches.at(-1);
  const id = createHash('sha256').update(`refine:prompt:${trajectory.id}`).digest('hex').slice(0, 24);
  const existing = state.read('prompt-notes', id);
  return {
    collection: 'prompt-notes', op: existing ? 'update' : 'create', id,
    patch: { text: event.detail },
    evidence: { source: `${path.resolve(file)}#/events/${index}`, detail: event.detail },
  };
}
