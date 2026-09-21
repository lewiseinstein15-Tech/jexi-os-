#!/usr/bin/env node
/**
 * JEXI OS — PHASE 13 SCOPE A — VENDOR CATALOG GENERATOR.
 *
 *   node scripts/phase13-vendor-agency.mjs --src /path/to/agency-agents
 *   node scripts/phase13-vendor-agency.mjs --src <dir> --check
 *
 * Projects the upstream catalog (msitarzewski/agency-agents, MIT) into
 * workforce/agents/vendor/agency-agents.specs.json — one structured spec per
 * upstream agent. The upstream corpus is prose blobs (a 200-line .md per
 * agent); the roster needs specs, so this script keeps each agent's identity
 * and description and derives the machine-usable fields (capabilities,
 * division, trust) through the same inference the live tree uses.
 *
 * The upstream .md files are NOT copied into the repo: 4.4 MB of prose would
 * duplicate the roster's contract without adding a single field the runtime
 * reads. vendor/README.md records provenance and the pinned upstream commit instead.
 *
 * Deterministic: rows sort by id, so the same upstream checkout produces a
 * byte-identical catalog.
 *
 * --check exits 1 when the committed catalog disagrees with --src.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { inferCapabilities } from '../workforce/agents/capabilities.js';
import { initialTrustLevel } from '../workforce/agents/infer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const OUT = path.join(REPO, 'workforce/agents/vendor/agency-agents.specs.json');

const args = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const SRC = argVal('--src', process.env.AGENCY_AGENTS_SRC || '');

const UPSTREAM = 'msitarzewski/agency-agents';
const UPSTREAM_COMMIT = '87f8301cad3823a9a34d762036ae923a0eff306f';
const UPSTREAM_LICENSE = 'MIT';

/** Upstream divisions (their directories), in their own order. */
const UPSTREAM_DIVISIONS = [
  'academic', 'design', 'engineering', 'finance', 'game-development', 'gis',
  'healthcare', 'marketing', 'paid-media', 'product', 'project-management',
  'research', 'sales', 'security', 'spatial-computing', 'specialized',
  'support', 'testing',
];

/** Upstream division -> one of JEXI's 18 divisions (workforce/divisions.json). */
const DIVISION_MAP = {
  academic: 'learning',
  design: 'design',
  engineering: 'engineering',
  finance: 'business',
  'game-development': 'product',
  gis: 'visualization',
  healthcare: 'research',
  marketing: 'content',
  'paid-media': 'business',
  product: 'product',
  'project-management': 'ops',
  research: 'research',
  sales: 'business',
  security: 'security',
  'spatial-computing': 'visualization',
  specialized: 'business',
  support: 'ops',
  testing: 'testing',
};

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function firstRole(text, fallback) {
  const m = /^\s*[-*]?\s*\*{0,2}Role\*{0,2}:\s*(.+)$/m.exec(String(text || ''));
  if (m) return m[1].trim().replace(/^[-–—]\s*/, '').slice(0, 300);
  return String(fallback || '').trim().slice(0, 300) || 'specialist';
}

function build() {
  if (!SRC || !fs.existsSync(SRC)) {
    console.error(`--src is required and must exist (got: ${SRC || '<empty>'})`);
    process.exit(2);
  }
  const agents = [];
  const bySourceDivision = {};
  for (const upstreamDiv of UPSTREAM_DIVISIONS) {
    const dir = path.join(SRC, upstreamDiv);
    if (!fs.existsSync(dir)) continue;
    let n = 0;
    for (const f of walk(dir)) {
      if (!f.endsWith('.md')) continue;
      const text = fs.readFileSync(f, 'utf8');
      const meta = frontmatter(text);
      if (!meta || !meta.name || !meta.description) continue;
      const id = path.basename(f, '.md');
      const division = DIVISION_MAP[upstreamDiv] || 'engineering';
      const role = firstRole(text, meta.description);
      const row = {
        id,
        name: meta.name,
        division,
        role,
        description: meta.description,
        capabilities: inferCapabilities({ id, name: meta.name, role, description: meta.description, division }),
        trustLevel: initialTrustLevel('agency-agents'),
        sourceDivision: upstreamDiv,
        sourcePath: path.relative(SRC, f).split(path.sep).join('/'),
      };
      agents.push(row);
      n += 1;
    }
    bySourceDivision[upstreamDiv] = n;
  }
  agents.sort((a, b) => a.id.localeCompare(b.id));
  return {
    kind: 'jexi.workforce.vendor-catalog',
    version: 1,
    upstream: UPSTREAM,
    upstreamCommit: UPSTREAM_COMMIT,
    license: UPSTREAM_LICENSE,
    note: 'Machine-usable projection of the upstream catalog. Prose bodies are NOT vendored; see vendor/README.md.',
    count: agents.length,
    bySourceDivision,
    agents,
  };
}

const payload = build();
const body = JSON.stringify(payload, null, 2) + '\n';

if (args.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current === body) {
    console.log(`OK vendor catalog matches ${SRC} (${payload.count} agents).`);
    process.exit(0);
  }
  console.error(`DRIFT: ${path.relative(REPO, OUT)} does not match ${SRC}.`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);
console.log(`wrote ${path.relative(REPO, OUT)}: ${payload.count} agents`);
console.log('by upstream division:', JSON.stringify(payload.bySourceDivision));