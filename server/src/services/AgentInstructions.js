/**
 * B136 — AGENT INSTRUCTIONS (DeepSeek Harness `packages/context/agent-instructions`
 * mirror, JEXI-branded).
 *
 * Workspace instruction loader for AGENTS.md-compatible files: discovers
 * instruction files (project root AGENTS.md + nested AGENTS.md up to depth 3,
 * plus a home-level `~/.jexi/AGENTS.md`), digests them (sha256 + line counts),
 * renders a bounded prompt section, and tracks which versions were last shown
 * so the model only sees genuinely NEW instructions when they change.
 *
 * Baseline instructions enter the prompt before the first request; successful
 * fs tool touches (read/write/edit) on nested instruction files mark them
 * "seen" (dsh's inbox reconciliation, simplified).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR, WORKSPACE_DIR } from '../config.js';
import { resolveJexiHome } from './HomePaths.js';

const STATE_FILE = path.join(DATA_DIR, 'agent-instructions-state.json');
const MAX_DEPTH = 3;
const MAX_FILES = 20;
const MAX_TOTAL_CHARS = 8000;

/** Discover AGENTS.md files under a root (case-insensitive, depth-bounded). */
export function discoverAgentInstructionFiles(root, { maxDepth = MAX_DEPTH, limit = MAX_FILES } = {}) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth || found.length >= limit) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const agents = entries.find((e) => e.isFile() && /^agents\.md$/i.test(e.name));
    if (agents) found.push({ dir, file: path.join(dir, agents.name) });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'data') continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  try { walk(root, 0); } catch { /* noop */ }
  return found.slice(0, limit);
}

/** One loaded instruction file. */
export function loadInstructionFile(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const text = fs.readFileSync(file, 'utf-8');
    const digest = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
    return {
      file,
      display: path.relative(WORKSPACE_DIR || process.cwd(), file) || file,
      digest,
      lines: text.split('\n').length,
      chars: text.length,
      body: text,
    };
  } catch { return null; }
}

/** Load the baseline instruction set: home-level + project + nested. */
export function loadBaselineInstructionSet({ root = WORKSPACE_DIR, home = null } = {}) {
  const files = [];
  const homeAgents = path.join(home || resolveJexiHome(), 'AGENTS.md');
  if (fs.existsSync(homeAgents)) files.push(homeAgents);
  const discovered = discoverAgentInstructionFiles(root);
  for (const d of discovered) files.push(d.file);
  return files.map(loadInstructionFile).filter(Boolean);
}

/* ---------------- state (which digests the model has seen) ---------------- */

function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch { /* fresh */ }
  return { seen: {}, updatedAt: 0 };
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch { /* noop */ }
}

/** Files whose digest changed since the model last saw them (or never seen). */
export function newInstructionVersions(instructions) {
  const state = readState();
  return instructions.filter((i) => state.seen[i.file] !== i.digest);
}

/** Mark instruction files as seen (after they were shown / touched). */
export function markInstructionsSeen(instructions) {
  const state = readState();
  for (const i of instructions) state.seen[i.file] = i.digest;
  state.updatedAt = Date.now();
  writeState(state);
}

/** Render a bounded prompt section from the instruction set. */
export function renderInstructionsBlock(instructions, { maxChars = MAX_TOTAL_CHARS } = {}) {
  if (!instructions || instructions.length === 0) return '';
  let out = '';
  const parts = [];
  let chars = 0;
  for (const i of instructions) {
    const head = `### ${i.display} (${i.lines} lines, ${i.chars} chars)`;
    const budget = Math.max(600, Math.min(i.chars, Math.floor((maxChars - chars) / Math.max(1, instructions.length - parts.length))));
    const body = i.body.length > budget ? `${i.body.slice(0, budget)}\n…[truncated]` : i.body;
    const part = `\n${head}\n${body}`;
    if (chars + part.length > maxChars && parts.length > 0) break;
    parts.push(part);
    chars += part.length;
  }
  if (parts.length === 0) return '';
  out = `\n\n[Project instructions (AGENTS.md) — follow these working rules:\n${parts.join('\n')}\n]`;
  return out.slice(0, maxChars + 400);
}

/** Touch a nested instruction file when a fs tool hits it (marks it seen).
 *  Relative paths resolve against the workspace root (plugin fs tools pass
 *  relative paths); absolute paths are used as-is. */
export function touchProjectInstructions(touchedPath, { root = WORKSPACE_DIR } = {}) {
  try {
    if (!touchedPath) return;
    const abs = path.isAbsolute(String(touchedPath)) ? String(touchedPath) : path.join(root, String(touchedPath));
    if (!/agents\.md$/i.test(path.basename(abs))) return;
    const inst = loadInstructionFile(abs);
    if (inst) markInstructionsSeen([inst]);
  } catch { /* noop */ }
}

/** Full status for /api/project/instructions. */
export function agentInstructionsStatus({ root = WORKSPACE_DIR } = {}) {
  const instructions = loadBaselineInstructionSet({ root });
  const state = readState();
  return {
    files: instructions.map((i) => ({ file: i.display, digest: i.digest, lines: i.lines, chars: i.chars })),
    totalChars: instructions.reduce((n, i) => n + i.chars, 0),
    newSinceLastShown: newInstructionVersions(instructions).length,
    stateUpdatedAt: state.updatedAt,
  };
}
