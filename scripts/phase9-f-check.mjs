#!/usr/bin/env node
/**
 * JEXI OS — Phase 9 Scope F — license-boundary check (P10).
 *
 * Asserts: EVERY host registered in intelligence/trust-pipeline/
 * registered-urls.js (the single source of truth for external URLs the
 * trust pipeline may contact) appears in DATA_SOURCES.md (the per-source
 * license table).
 *
 * Exit 0 = every registered source is listed. Exit 1 = at least one
 * registered host is MISSING from DATA_SOURCES.md (named specifically).
 * Run: node scripts/phase9-f-check.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Direct-run detection: only auto-run the check when executed directly
// (importing this file as a library must not trigger an exit).
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const { REGISTERED_URLS } = await import(
  pathToFileURL(join(ROOT, 'intelligence', 'trust-pipeline', 'registered-urls.js')).href
);
const dataSources = readFileSync(join(ROOT, 'DATA_SOURCES.md'), 'utf8');

const rows = REGISTERED_URLS.map((r) => {
  // Exact-host match first; fall back to base-domain match for
  // provider rows that cover subdomains (e.g. `api.adsb.lol` listed
  // under an adsb.lol provider row).
  const exact = dataSources.includes(`\`${r.host}\``) || dataSources.includes(r.host);
  const base = r.host.split('.').slice(-2).join('.');
  const viaBase = !exact && dataSources.includes(`\`${base}\``);
  return { id: r.id, host: r.host, provider: r.provider, layer: r.layer, listed: exact || viaBase, how: exact ? 'exact host' : viaBase ? `base domain \`${base}\`` : null };
});

const listed = rows.filter((r) => r.listed);
const missing = rows.filter((r) => !r.listed);

console.log('--- phase9-f-check: registered-urls.js ↔ DATA_SOURCES.md (raw) ---');
for (const r of rows) {
  console.log(`${r.listed ? 'LISTED  ' : 'MISSING '} ${r.host} (${r.provider}, layer=${r.layer})${r.how ? ` [${r.how}]` : ''}`);
}
console.log('--- summary (raw) ---');
console.log(`${rows.length} registered sources, ${listed.length} listed, ${missing.length} missing`);
if (missing.length > 0) {
  console.log('MISSING FROM DATA_SOURCES.md:');
  for (const m of missing) console.log(`  - ${m.host} (${m.provider})`);
}

if (isDirectRun) process.exit(missing.length === 0 ? 0 : 1);
