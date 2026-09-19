// research/constraints/mutable.js
// The positive policy: exactly what the research agent MAY edit.
// Patterned on karpathy/autoresearch (MIT): there the agent edits exactly one
// file (train.py); the same single-file discipline applies here. Everything
// not listed is implicitly NOT editable (fail-closed default in read-only.js).
import { MUTABLE, MUTABLE_DIRS, globMatch } from './read-only.js';

export const MUTABLE_FILES = [...MUTABLE]; // the train.py analog
export const MUTABLE_SANDBOX_DIRS = [...MUTABLE_DIRS]; // experiment scratch space

// CONTRACT helper: is this path inside the agent's editable set?
// extra: additional patterns a host (probe, overnight driver) may grant for
// its own sandbox dirs. Never grants anything READ_ONLY already forbids —
// guards.js checks read-only FIRST, so this cannot unlock protected files.
export function isMutablePath(p, { extra = [] } = {}) {
  const norm = String(p).replace(/\\/g, '/').replace(/^\.\//, '');
  return globMatch([...MUTABLE_FILES, ...MUTABLE_SANDBOX_DIRS, ...extra], norm);
}

export function mutableSet() {
  return { files: [...MUTABLE_FILES], dirs: [...MUTABLE_SANDBOX_DIRS] };
}
