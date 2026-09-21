/**
 * JEXI OS — Phase 15 Scope A — living plan.
 *
 * The plan is a JSON document in the vault: { goal, items[], next }.
 * triagePlan() re-triages every new input against the CURRENT plan:
 * a line that matches an existing item (normalized, substring either
 * way) is a no-op match; anything else becomes a new open item.
 * Fully deterministic — no clocks, ids are a monotonic counter, and
 * rendering sorts nothing because insertion order IS the plan.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../../semantica/_internal.js';

const planPath = (vault) => path.join(vault, 'plan.json');

export function loadPlan(vault) {
  if (!fs.existsSync(planPath(vault))) return { goal: '', items: [], next: 1 };
  try {
    const p = JSON.parse(fs.readFileSync(planPath(vault), 'utf8'));
    if (!p || !Array.isArray(p.items)) throw fail('E_BAD_PLAN', 'plan.json is malformed');
    return { goal: p.goal || '', items: p.items, next: p.next || p.items.length + 1 };
  } catch (e) {
    if (e && e.code === 'E_BAD_PLAN') throw e;
    throw fail('E_BAD_PLAN', 'plan.json unreadable: ' + e.message);
  }
}

export function savePlan(vault, plan) {
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(planPath(vault), JSON.stringify(plan, null, 2) + '\n');
  return plan;
}

export function renderPlan(plan) {
  const lines = ['# ' + (plan.goal || '(no goal)')];
  for (const it of plan.items) lines.push('- [' + it.status + '] ' + it.id + ': ' + it.text);
  return lines.join('\n') + '\n';
}

const norm = (s) => String(s).toLowerCase().trim();

export function triagePlan(plan, newInput) {
  if (newInput === undefined || newInput === null) {
    throw fail('E_MISSING_INPUT', 'triage requires input');
  }
  const actions = [];
  let changed = false;
  const lines = String(newInput).split('\n').map((l) => l.trim()).filter((l) => l !== '');
  for (const line of lines) {
    const n = norm(line);
    const match = plan.items.find((it) => n === norm(it.text) || n.includes(norm(it.text)) || norm(it.text).includes(n));
    if (match) {
      actions.push({ type: 'match', item: match.id, input: line });
    } else {
      const id = 'item-' + String(plan.next).padStart(3, '0');
      plan.next += 1;
      plan.items.push({ id, text: line, status: 'open' });
      actions.push({ type: 'add', item: id, input: line });
      changed = true;
    }
  }
  return { changed, plan, actions };
}
