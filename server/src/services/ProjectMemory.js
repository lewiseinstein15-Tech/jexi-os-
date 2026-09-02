/**
 * B191 — PROJECT MEMORY ("remember this project").
 *
 * A project = durable, resumable unit of work that survives days:
 *   saveProject({name, goal, conversationId, files, decisions, notes})
 *   listProjects()              → the portfolio with status + age
 *   resumeProject(name|id)      → a RESTORE BRIEF the model reads to pick up
 *                                 EXACTLY where things stopped (goal, files,
 *                                 decisions, last 6 turns, next steps)
 *   updateProject(id, patch)    → append decisions/next-steps as work continues
 *   closeProject(id)            → mark done (kept for reference)
 *
 * Storage: DATA_DIR/projects/<id>.json — survives restarts, isolated from
 * chat memory. Chat intent:
 *   "remember this project [as X]"   → save (name auto-derived if omitted)
 *   "continue project X" / "resume"  → resume brief into the turn
 *   "my projects"                    → list
 *   "project X is done"              → close
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from '../config.js';
import { loadConversationEvents } from './SessionConversations.js';
import { listWorkspace } from './WorkspaceRuntime.js';

const DIR = path.join(DATA_DIR, 'projects');
fs.mkdirSync(DIR, { recursive: true });

const fileFor = (id) => path.join(DIR, `${String(id).replace(/[^a-z0-9-]/gi, '')}.json`);

function readAll() {
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf-8')); } catch { return null; } })
    .filter(Boolean);
}

export function saveProject({ name, goal = '', conversationId = null, decisions = [], nextSteps = [], notes = '' }) {
  const id = `prj-${(slugify(name || goal) || 'x').slice(0, 24)}-${crypto.randomUUID().slice(0, 5)}`;
  const project = {
    id,
    name: String(name || 'Untitled project').slice(0, 80),
    goal: String(goal).slice(0, 500),
    conversationId: conversationId || null,
    decisions: decisions.slice(0, 30),
    nextSteps: nextSteps.slice(0, 20),
    notes: String(notes).slice(0, 2000),
    files: snapshotWorkspace(),
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(fileFor(id), JSON.stringify(project, null, 2), 'utf-8');
  return project;
}

export function updateProject(idOrName, patch = {}) {
  const p = findProject(idOrName);
  if (!p) return null;
  if (patch.addDecision) p.decisions = [...p.decisions, String(patch.addDecision).slice(0, 300)].slice(-30);
  if (patch.addNextStep) p.nextSteps = [...p.nextSteps, String(patch.addNextStep).slice(0, 300)].slice(-20);
  if (patch.completeStep) p.nextSteps = p.nextSteps.filter((s) => s !== patch.completeStep);
  if (patch.notes) p.notes = String(patch.notes).slice(0, 2000);
  if (patch.goal) p.goal = String(patch.goal).slice(0, 500);
  if (patch.status) p.status = patch.status;
  p.files = snapshotWorkspace();
  p.updatedAt = new Date().toISOString();
  fs.writeFileSync(fileFor(p.id), JSON.stringify(p, null, 2), 'utf-8');
  return p;
}

export function closeProject(idOrName) {
  const p = findProject(idOrName);
  if (!p) return null;
  p.status = 'done';
  p.updatedAt = new Date().toISOString();
  fs.writeFileSync(fileFor(p.id), JSON.stringify(p, null, 2), 'utf-8');
  return p;
}

export function listProjects({ includeDone = true } = {}) {
  return readAll()
    .filter((p) => includeDone || p.status !== 'done')
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .map((p) => ({ id: p.id, name: p.name, goal: p.goal, status: p.status, files: p.files.length, updatedAt: p.updatedAt, nextSteps: p.nextSteps }));
}

export function findProject(idOrName) {
  const key = String(idOrName || '').toLowerCase();
  return readAll().find((p) => p.id.toLowerCase() === key || p.name.toLowerCase() === key || slugify(p.name) === slugify(key));
}

/**
 * The RESUME BRIEF: everything the model needs to continue exactly where the
 * project stopped — goal, current files, decisions, next steps and the last
 * turns of the project conversation.
 */
export function resumeBrief(idOrName) {
  const p = findProject(idOrName);
  if (!p) return null;
  let tail = '';
  if (p.conversationId) {
    try {
      const evs = loadConversationEvents(p.conversationId, 12).filter((e) => e.role === 'user' || e.role === 'jexi');
      tail = evs.slice(-6).map((e) => `${e.role === 'user' ? 'User' : 'JEXI'}: ${String(e.text).slice(0, 220)}`).join('\n');
    } catch { /* conversation gone — brief still works */ }
  }
  return [
    `# Resuming project: ${p.name}`,
    `Goal: ${p.goal}`,
    `Status: ${p.status} · last touched ${new Date(p.updatedAt).toLocaleString()}`,
    p.files.length ? `Current files in the workspace (${p.files.length}): ${p.files.slice(0, 12).join(', ')}${p.files.length > 12 ? '…' : ''}` : 'Workspace is empty — files may have been swept.',
    p.decisions.length ? `Decisions made so far:\n${p.decisions.map((d) => `- ${d}`).join('\n')}` : '',
    p.nextSteps.length ? `Next steps when we stopped:\n${p.nextSteps.map((s) => `- [ ] ${s}`).join('\n')}` : 'No recorded next steps — infer them from the goal and conversation.',
    tail ? `Last exchange:\n${tail}` : '',
    `Continue this project from exactly where it stopped. Do not restart from scratch and do not re-ask what the user already answered.`,
  ].filter(Boolean).join('\n\n');
}

function snapshotWorkspace() {
  try { return (listWorkspace() || []).map((f) => f.name || String(f)).filter((n) => !/^(venv|node_modules)\//.test(n)).slice(0, 40); }
  catch { return []; }
}

function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
