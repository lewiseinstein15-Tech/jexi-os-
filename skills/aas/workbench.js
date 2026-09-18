#!/usr/bin/env node
/**
 * JEXI OS — AAS CORE — workbench.js
 *
 * Renders the human review surface: a fully SELF-CONTAINED HTML file
 * (inline CSS + embedded JSON, zero external resources — opens in any
 * browser from disk, no server). Shows the catalog, the persisted stack,
 * and the plan hash + verify status.
 *
 * CLI:  node workbench.js [--stack aas-stack.json] [--plan plan.json] [--out aas-workbench.html]
 * API:  render({ stack, plan, outPath }) → { path, bytes }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { list, diagnostics } from './catalog.js';
import { loadStack, DEFAULT_STACK_PATH } from './aas-stack.js';
import { verify as verifyPlan } from './plan.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function render({ stack = null, plan = null, catalog = list(), diags = diagnostics() } = {}) {
  const planOk = plan ? verifyPlan(plan) : null;
  const data = { generatedAt: new Date().toISOString(), stack, plan: plan ? { ...plan, verify: planOk } : null, catalog, diagnostics: diags };
  const rows = catalog.map((s) => `
<tr><td><code>${esc(s.id)}</code></td><td>${esc(s.description.slice(0, 120))}${s.description.length > 120 ? '…' : ''}</td><td class="dim">${esc(s.path)}</td></tr>`).join('');
  const stackHtml = stack ? `
<h2>Stack <span class="ok">VALID</span></h2>
<p>${stack.ids.length} skills · ${stack.totalDescriptionChars}/${stack.budget} budget chars</p>
<ul>${stack.ids.map((i) => `<li><code>${esc(i)}</code></li>`).join('')}</ul>` : '<h2>Stack</h2><p class="dim">none loaded</p>';
  const planHtml = plan ? `
<h2>Plan <span class="${planOk ? 'ok' : 'bad'}">${planOk ? 'HASH VERIFIED — immutable' : 'HASH MISMATCH — modified'}</span></h2>
<p>id <code>${esc(plan.id)}</code> · created ${esc(plan.createdAt)}</p>
<p class="dim">sha256 ${esc(plan.hash)}</p>` : '<h2>Plan</h2><p class="dim">none loaded</p>';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>JEXI AAS Workbench</title>
<style>
 body{font-family:system-ui,sans-serif;background:#f5f5f5;color:#2d3142;margin:0;padding:2rem}
 h1{border-bottom:3px solid #eb6c36;padding-bottom:.4rem}
 code{background:#ececec;padding:.1rem .35rem;border-radius:4px;font-size:.9em}
 .ok{color:#1a7f37;font-weight:700}.bad{color:#c0392b;font-weight:700}.dim{color:#7a8399;font-size:.85rem}
 table{border-collapse:collapse;width:100%;background:#fff;margin:1rem 0}
 td,th{border:1px solid #bfc0c0;padding:.45rem .6rem;text-align:left;font-size:.9rem}
 th{background:#ececec}
 .card{background:#fff;border:1px solid #bfc0c0;border-radius:8px;padding:1rem 1.25rem;margin:1rem 0}
</style></head><body>
<h1>JEXI AAS Workbench</h1>
<p class="dim">Generated ${esc(data.generatedAt)} · self-contained, review offline · catalog ${catalog.length} skills (${diags.skipped.length} skipped)</p>
<div class="card">${stackHtml}</div>
<div class="card">${planHtml}</div>
<h2>Catalog (${catalog.length})</h2>
<table><tr><th>id</th><th>description</th><th>path</th></tr>${rows}</table>
<script type="application/json" id="aas-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
</body></html>`;
}

export function writeWorkbench({ stackPath = DEFAULT_STACK_PATH, planPath = null, outPath = path.join(HERE, 'aas-workbench.html') } = {}) {
  let stack = null, plan = null;
  if (stackPath && fs.existsSync(stackPath)) { const loaded = loadStack({ path: stackPath }); stack = { ids: loaded.ids, skills: loaded.skills, totalDescriptionChars: loaded.totalDescriptionChars, budget: loaded.budget }; }
  if (planPath && fs.existsSync(planPath)) plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const html = render({ stack, plan });
  fs.writeFileSync(outPath, html);
  return { path: outPath, bytes: fs.statSync(outPath).size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const r = writeWorkbench({ stackPath: get('--stack', DEFAULT_STACK_PATH), planPath: get('--plan', null), outPath: get('--out', path.join(HERE, 'aas-workbench.html')) });
  console.log(`WROTE ${r.path} (${r.bytes} bytes) — self-contained HTML, opens in any browser from disk`);
}
