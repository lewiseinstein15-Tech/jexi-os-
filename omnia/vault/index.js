/**
 * JEXI OS — Phase 15 Scope A — Omnia Vault entry point.
 *
 *   const vault = createVault(vaultPath)
 *   vault.index(root)               -> { notes, edges, plan }
 *   vault.triage(newInput)          -> { changed, plan, actions[] }
 *   vault.catchup()                 -> { state, plan, recentChanges }
 *   vault.note(id)                  -> note          (unknown -> E_UNKNOWN_NOTE)
 *   vault.note(id, {title,body,tags}) -> note        (create/update)
 *
 * Consumes Phase 14 read-only: SemanticaError/fail from _internal,
 * scan() from repo-map for the code-graph walk.
 */
import fs from 'node:fs';
import { allNotes, loadNote, saveNote, backlinksOf } from './wiki.js';
import { codeGraph } from './code-graph.js';
import { loadPlan, savePlan, triagePlan, renderPlan } from './living-plan.js';
import { catchup, recordChange } from './catchup.js';

export function createVault(vaultPath) {
  if (typeof vaultPath !== 'string' || vaultPath.trim() === '') {
    throw new Error('vaultPath must be a non-empty string');
  }
  fs.mkdirSync(vaultPath, { recursive: true });
  return {
    path: vaultPath,
    index(root) {
      const notes = allNotes(vaultPath);
      const noteEdges = [];
      for (const n of notes) {
        for (const link of n.links) noteEdges.push({ from: n.id, to: link, kind: 'links-to' });
      }
      noteEdges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : (a.to < b.to ? -1 : 1)));
      const cg = codeGraph(root);
      return { notes, edges: [...noteEdges, ...cg.edges], plan: loadPlan(vaultPath) };
    },
    triage(newInput) {
      const plan = loadPlan(vaultPath);
      const result = triagePlan(plan, newInput);
      if (result.changed) savePlan(vaultPath, plan);
      const seq = recordChange(vaultPath, result.actions);
      return { ...result, seq };
    },
    catchup() {
      return catchup(vaultPath);
    },
    note(id, spec) {
      if (spec === undefined) return loadNote(vaultPath, id);
      return saveNote(vaultPath, { ...spec, id });
    },
    backlinks(id) {
      return backlinksOf(vaultPath, id);
    },
    renderPlan() {
      return renderPlan(loadPlan(vaultPath));
    },
  };
}

export { allNotes, loadNote, saveNote, parseNote, parseLinks, backlinksOf } from './wiki.js';
export { codeGraph } from './code-graph.js';
export { loadPlan, savePlan, triagePlan, renderPlan } from './living-plan.js';
export { catchup, recordChange, recentChanges } from './catchup.js';
export { SemanticaError } from '../../semantica/_internal.js';
