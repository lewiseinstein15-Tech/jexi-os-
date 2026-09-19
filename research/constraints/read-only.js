// research/constraints/read-only.js
// The immutable side of the research arena, patterned on karpathy/autoresearch (MIT):
// there prepare.py is read-only to the agent; here the same discipline is explicit.
// This module is POLICY DATA only — runtime enforcement lives in guards.js.

// Files/dirs the research agent must NEVER create, edit, or delete.
// Glob syntax: ** matches any depth, * matches within one segment.
export const READ_ONLY = [
  // judge + data (prepare.py analogs) — if the agent edits its own judge, results lie
  'research/fixtures/toy-target/data.js',
  'research/fixtures/toy-target/train.js',
  // the strategy file is HUMAN-editable only (Scope C)
  'research/program/program.md',
  // the parsers/engines the agent runs under must not be rewritten mid-run
  'research/constraints/**',
  'research/program/parse.js',
  'research/program/load.js',
  'research/program/load.js.map',
  'research/budget/**',
  'research/tracking/results.tsv', // the complete log is machine-managed (Scope E)
  'research/tracking/results.tsv.bak',
  'research/workgraph/**',
  'research/simplicity/**',
  'research/swarm/**',
  'research/templates/**',
  'research/overnight.js',
  'research/loop/**',
  // out-of-zone JEXI system surfaces (phase-owned; hard lock from the phase contract)
  'server/**',
  'security/**',
  'capability/**',
  'web/reach/**',
  'runtimes/browser/**',
  'context/viking/**',
  'skills/**',
  'AGENTS.md',
  '.jexi-secrets/**',
  'workforce/divisions.json',
  'commands/registry.js',
  'events/hud/**',
];

// The agent's train.py analog: exactly what it may edit.
export const MUTABLE = ['research/fixtures/toy-target/candidate.js'];

// Everything else is BY DEFAULT read-only (fail closed), unless it falls under
// the agent's scratch space (experiment sandboxes).
export const MUTABLE_DIRS = ['research/.probes/**'];

export function isReadOnlyPath(p) {
  const norm = String(p).replace(/\\/g, '/').replace(/^\.\//, '');
  return globMatch(READ_ONLY, norm) || !inMutableSet(norm);
}

function inMutableSet(norm) {
  if (globMatch(MUTABLE, norm)) return true;
  return globMatch(MUTABLE_DIRS, norm);
}

export function globMatch(patterns, path) {
  for (const pattern of patterns) {
    if (matchGlob(pattern, path)) return true;
  }
  return false;
}

export function matchGlob(pattern, path) {
  const re = globToRegExp(pattern);
  return re.test(path);
}

function globToRegExp(pattern) {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += pattern[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += pattern[i + 2] === '/' ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$');
}
