// research/program/load.js
// Load program.md fresh per cycle — the agent re-reads the human's strategy at
// the top of every experiment cycle (autoresearch pattern). Never cached:
// a human edit mid-run must be visible on the next loadProgram call.
import { readFile } from 'node:fs/promises';
import { parseProgram } from './parse.js';

// CONTRACT
//   loadProgram(path) -> { strategy: string, constraints: [...], ok: boolean, error? }
export async function loadProgram(path) {
  let md;
  try {
    md = await readFile(path, 'utf8');
  } catch (err) {
    return { strategy: '', constraints: [], ok: false, error: `unreadable: ${err?.message ?? err}` };
  }
  return parseProgram(md);
}
