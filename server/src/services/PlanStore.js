/**
 * JEXI OS — Plan Store (B96, DSH-style plan tool).
 * An explicit multi-step plan with per-step status, managed via the `plan` tool.
 * Persisted to DATA_DIR/plan.json.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const FILE = path.join(DATA_DIR, 'plan.json');
let plan = load();

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const p = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
      if (p && typeof p === 'object' && Array.isArray(p.steps)) return p;
    }
  } catch { /* fresh */ }
  return { title: '', steps: [], updatedAt: 0 };
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(plan, null, 2), 'utf-8');
  } catch { /* noop */ }
}

export function planGet() {
  return { ...plan, steps: plan.steps.map((s, i) => ({ index: i, ...s })) };
}

export function planSet(title, steps) {
  plan = {
    title: String(title || '').slice(0, 120),
    steps: (Array.isArray(steps) ? steps : []).map((s) => (typeof s === 'string' ? { text: s, status: 'pending' } : { text: String(s.text || '').slice(0, 300), status: s.status || 'pending' })),
    updatedAt: Date.now(),
  };
  save();
  return planGet();
}

export function planUpdate(index, status, note) {
  const s = plan.steps[index];
  if (s) {
    if (status) s.status = String(status).slice(0, 20);
    if (note) s.note = String(note).slice(0, 200);
    plan.updatedAt = Date.now();
    save();
  }
  return planGet();
}
