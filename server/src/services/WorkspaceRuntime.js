/**
 * JEXI OS — Workspace Runtime (roadmap stage 10: projects, checkpoints, diffs, rollback).
 *
 * Grok Build's workspace owns "host filesystem, VCS, execution, checkpoints".
 * This module gives JEXI the same traceability for the files it generates in
 * WORKSPACE_DIR: every meaningful state can be snapshotted, diffed and rolled
 * back — so an AI edit is never a one-way door.
 *
 * B53 P2 — TASK-SCOPED WORKSPACES (hard product isolation):
 * WORKSPACE_DIR stays the ACTIVE task's staging area (so preview links and
 * /api/files/* keep working unchanged), but every task gets its own archived
 * snapshot under DATA_DIR/task-workspaces/<taskId>/. Switching to a different
 * task archives the current files and restores (or starts empty for) the new
 * task — a new product objective NEVER inherits the previous product's files.
 *
 *   list()                  — workspace files with metadata
 *   read()                  — file content (bounded)
 *   write()                 — write a workspace file (path-escape safe)
 *   checkpoint()            — snapshot every workspace file → DATA_DIR/workspace-cps/
 *   listCheckpoints()       — newest first, with file counts
 *   diff()                  — line diff between a checkpoint and the current workspace
 *   rollback()              — restore every file (or one file) from a checkpoint
 *   activateTaskWorkspace() — switch the active staging area to a task (B53 P2)
 *   archiveTaskWorkspace()  — snapshot the active staging area for a task (B53 P2)
 */

import fs from 'fs';
import path from 'path';
import { WORKSPACE_DIR, DATA_DIR } from '../config.js';

const CP_DIR = path.join(DATA_DIR, 'workspace-cps');
const TASK_WS_ROOT = path.join(DATA_DIR, 'task-workspaces');
const MAX_FILE_CHARS = 50000;

/* ---------------- B53 P2 — per-task workspace isolation ---------------- */

/** Which task owns the current WORKSPACE_DIR contents (module state). */
let activeWorkspaceTask = null;

export function taskWorkspaceDir(taskId) {
  return path.join(TASK_WS_ROOT, String(taskId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, ''));
}

function clearDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir)) {
    const p = path.join(dir, ent);
    try {
      if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
    } catch (e) { /* skip locked files */ }
  }
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src)) {
    const from = path.join(src, ent);
    const to = path.join(dst, ent);
    try {
      if (fs.statSync(from).isDirectory()) copyDir(from, to);
      else fs.copyFileSync(from, to);
    } catch (e) { /* skip */ }
  }
}

/** Snapshot the CURRENT staging area (WORKSPACE_DIR) under a task id. */
export function archiveTaskWorkspace(taskId) {
  const dir = taskWorkspaceDir(taskId);
  if (!fs.existsSync(WORKSPACE_DIR)) return { taskId, archived: false };
  const files = fs.readdirSync(WORKSPACE_DIR);
  if (!files.length) return { taskId, archived: false };
  clearDir(dir);
  fs.mkdirSync(dir, { recursive: true });
  copyDir(WORKSPACE_DIR, dir);
  return { taskId, archived: true, fileCount: files.length };
}

/**
 * Switch the active staging area to a task: archive the CURRENT owner's
 * files (if any), clear the staging area, and restore the target task's
 * archived snapshot (or leave it empty for a brand-new product). Returns
 * { taskId, restored } where restored = the previous files were cleared and
 * this task's snapshot was brought back.
 */
export function activateTaskWorkspace(taskId) {
  if (!taskId) return { taskId: null, restored: false };
  if (activeWorkspaceTask && activeWorkspaceTask !== taskId) {
    archiveTaskWorkspace(activeWorkspaceTask);
  }
  const dir = taskWorkspaceDir(taskId);
  clearDir(WORKSPACE_DIR);
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  let restored = false;
  if (fs.existsSync(dir)) {
    copyDir(dir, WORKSPACE_DIR);
    restored = true;
  }
  activeWorkspaceTask = taskId;
  return { taskId, restored, fresh: !restored };
}

/** Which task currently owns the staging area (for tests / diagnostics). */
export function activeTaskIdNow() {
  return activeWorkspaceTask;
}

function ensureWorkspace() {
  if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

/** Resolve a workspace-relative name and reject path escapes. */
function resolvePath(name) {
  const safe = String(name || '').replace(/^\/+/, '');
  const target = path.resolve(WORKSPACE_DIR, safe);
  if (!target.startsWith(path.resolve(WORKSPACE_DIR))) {
    throw new Error('Path escapes the workspace');
  }
  return target;
}

/** All files currently in the workspace (recursive, bounded depth). */
export function listWorkspace(limit = 500) {
  ensureWorkspace();
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      if (out.length >= limit) return;
      const abs = path.join(dir, ent.name);
      const relPath = rel ? path.join(rel, ent.name) : ent.name;
      if (ent.isDirectory()) walk(abs, relPath);
      else if (ent.isFile()) {
        try {
          const stat = fs.statSync(abs);
          out.push({ name: relPath, size: stat.size, modified: stat.mtime.toISOString() });
        } catch (e) { /* skip */ }
      }
    }
  };
  walk(WORKSPACE_DIR, '');
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read a workspace file (bounded to MAX_FILE_CHARS). */
export function readWorkspace(name) {
  const target = resolvePath(name);
  if (!fs.existsSync(target)) throw new Error(`File not found: ${name}`);
  const content = fs.readFileSync(target, 'utf-8');
  return content.length > MAX_FILE_CHARS ? content.slice(0, MAX_FILE_CHARS) + `\n… [truncated at ${MAX_FILE_CHARS} chars]` : content;
}

/** Write (or create) a workspace file. */
export function writeWorkspace(name, content) {
  const target = resolvePath(name);
  ensureWorkspace();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, String(content ?? ''), 'utf-8');
  return { name, size: fs.statSync(target).size };
}

/* ---------------- Checkpoints ---------------- */

function cpPath(stamp) {
  return path.join(CP_DIR, `${String(stamp).replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
}

/** Snapshot the whole workspace. Returns the checkpoint id + file count. */
export function createCheckpoint(label = '') {
  ensureWorkspace();
  if (!fs.existsSync(CP_DIR)) fs.mkdirSync(CP_DIR, { recursive: true });
  const files = listWorkspace(1000);
  const snapshot = {};
  for (const f of files) {
    try { snapshot[f.name] = fs.readFileSync(path.join(WORKSPACE_DIR, f.name), 'utf-8'); } catch (e) { /* skip unreadable */ }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const id = `cp-${stamp}`;
  fs.writeFileSync(cpPath(id), JSON.stringify({ id, label: String(label || ''), time: Date.now(), files: snapshot }, null, 2), 'utf-8');
  // Prune: keep the newest 30 checkpoints so disk never grows forever.
  const cps = listCheckpoints();
  for (const old of cps.slice(30)) {
    try { fs.unlinkSync(cpPath(old.id)); } catch (e) {}
  }
  return { id, label: String(label || ''), time: Date.now(), fileCount: Object.keys(snapshot).length };
}

/** List checkpoints newest first. */
export function listCheckpoints() {
  if (!fs.existsSync(CP_DIR)) return [];
  return fs.readdirSync(CP_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(CP_DIR, f), 'utf-8'));
        return { id: raw.id || f.replace('.json', ''), label: raw.label || '', time: raw.time, fileCount: Object.keys(raw.files || {}).length };
      } catch (e) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.time || 0) - (a.time || 0));
}

function loadCheckpoint(id) {
  const p = cpPath(id);
  if (!fs.existsSync(p)) throw new Error(`Checkpoint not found: ${id}`);
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

/** Simple unified line diff (added/removed) between two file versions. */
export function diffFiles(a, b) {
  const linesA = String(a || '').split('\n');
  const linesB = String(b || '').split('\n');
  // LCS-based diff for bounded input sizes; falls back to changed-line counts.
  const n = linesA.length, m = linesB.length;
  if (n * m > 200_000) {
    const added = linesB.filter((l) => !linesA.includes(l));
    const removed = linesA.filter((l) => !linesB.includes(l));
    return { added: added.length, removed: removed.length, lines: [...removed.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`)].slice(0, 200) };
  }
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = linesA[i] === linesB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (linesA[i] === linesB[j]) { i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push(`- ${linesA[i]}`); i++; }
    else { lines.push(`+ ${linesB[j]}`); j++; }
  }
  while (i < n) { lines.push(`- ${linesA[i]}`); i++; }
  while (j < m) { lines.push(`+ ${linesB[j]}`); j++; }
  return { added: lines.filter((l) => l.startsWith('+')).length, removed: lines.filter((l) => l.startsWith('-')).length, lines: lines.slice(0, 300) };
}

/**
 * Diff the current workspace against a checkpoint.
 * Returns per-file diffs { name, added, removed, lines, exists, deleted }.
 */
export function diffCheckpoint(id) {
  const cp = loadCheckpoint(id);
  const current = listWorkspace(1000);
  const byName = new Map(current.map((f) => [f.name, f]));
  const out = [];
  for (const [name, snapshotContent] of Object.entries(cp.files || {})) {
    if (!byName.has(name)) {
      out.push({ name, exists: false, deleted: true, added: 0, removed: snapshotContent.split('\n').length, lines: snapshotContent.split('\n').slice(0, 60).map((l) => `- ${l}`) });
      continue;
    }
    const currentContent = fs.readFileSync(path.join(WORKSPACE_DIR, name), 'utf-8');
    const d = diffFiles(snapshotContent, currentContent);
    if (d.added || d.removed) out.push({ name, exists: true, ...d });
  }
  for (const f of current) {
    if (!(f.name in (cp.files || {}))) {
      const content = fs.readFileSync(path.join(WORKSPACE_DIR, f.name), 'utf-8');
      out.push({ name: f.name, exists: true, added: content.split('\n').length, removed: 0, lines: content.split('\n').slice(0, 60).map((l) => `+ ${l}`) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Restore the workspace from a checkpoint (optionally one file). */
export function rollbackCheckpoint(id, fileName = null) {
  const cp = loadCheckpoint(id);
  const restored = [];
  for (const [name, content] of Object.entries(cp.files || {})) {
    if (fileName && name !== fileName) continue;
    const target = resolvePath(name);
    ensureWorkspace();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
    restored.push(name);
  }
  return { checkpoint: id, restored, count: restored.length };
}
