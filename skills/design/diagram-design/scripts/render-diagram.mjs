#!/usr/bin/env node
/**
 * diagram-design — REAL deterministic SVG renderer (dependency-free).
 * v1 (phase-12): 8 core types scripted, 32 catalog-only (RENDERER_NOT_IMPLEMENTED).
 * v2 (phase-17 Scope H): ALL 40 types render — each type is a registry module
 * (types/<name>.type.js) with an inputSchema and a deterministic render(spec);
 * this CLI is a thin dispatcher over ../render.js. Same interface as v1:
 *
 * Usage:
 *   node render-diagram.mjs --list-types
 *   node render-diagram.mjs --type flowchart --spec spec.json --out out.svg
 *   node render-diagram.mjs --type flowchart --input spec.json --output out.svg
 *   cat spec.json | node render-diagram.mjs --type flowchart --out out.svg
 *
 * v1 aliases still accepted: state → state-machine, journey → user-journey,
 * dependency → dependency-graph, db-schema → database-schema.
 */
import fs from 'node:fs';
import { renderDiagram, listTypes } from '../render.js';

const ALIASES = {
  state: 'state-machine',
  journey: 'user-journey',
  dependency: 'dependency-graph',
  'db-schema': 'database-schema',
};

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const typeArg = get('--type');
const specPath = get('--spec') || get('--input');
const outPath = get('--out') || get('--output');

if (args.includes('--list-types') || (!typeArg && !process.stdin.isTTY)) {
  for (const t of listTypes()) {
    const req = (t.inputSchema && t.inputSchema.required) || [];
    console.log(`${t.name.padEnd(20)} ${t.label.padEnd(26)} requires: ${req.join(', ') || '—'}`);
  }
  console.log(`\n${listTypes().length} types · deterministic SVG · aliases: ${Object.entries(ALIASES).map(([a, b]) => `${a}→${b}`).join(', ')}`);
  process.exit(0);
}

if (!typeArg) {
  console.error('E_NO_TYPE: pass --type <name> (or --list-types)');
  process.exit(1);
}

const canonical = ALIASES[typeArg] || typeArg;

let spec = {};
if (specPath) {
  try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8')); }
  catch (e) { console.error(`E_INPUT: cannot read ${specPath}: ${e.message}`); process.exit(1); }
} else {
  try { spec = JSON.parse(fs.readFileSync(0, 'utf8')); }
  catch (e) { console.error(`E_INPUT: no --spec/--input and stdin empty: ${e.message}`); process.exit(1); }
}

const outFile = outPath || `/tmp/${canonical}.svg`;

try {
  const { svg, width, height } = renderDiagram(canonical, spec);
  fs.writeFileSync(outFile, svg);
  console.log(`${canonical} → ${outFile} (${svg.length} bytes, ${width}x${height})`);
} catch (e) {
  if (e.code === 'E_UNKNOWN_TYPE') console.error(`${e.code}: ${e.message}`);
  else console.error(`${e.code || 'E_RENDER'}: ${e.message}`);
  process.exit(1);
}
