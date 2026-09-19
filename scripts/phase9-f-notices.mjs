#!/usr/bin/env node
/**
 * JEXI OS — Phase 9 Scope F — THIRD_PARTY_NOTICES.md generator.
 *
 * Aggregates dependency licenses from BOTH package.json manifests
 * (repo root + server/), reading each dependency's own package.json in
 * its node_modules (the declared license field — never invented).
 * Groups MIT / Apache / BSD / ISC as requested; flags any GPL/AGPL/
 * LGPL copyleft license prominently (distribution impact); flags
 * missing or non-standard license declarations.
 *
 * Output: THIRD_PARTY_NOTICES.md at repo root. Run from anywhere:
 *   node scripts/phase9-f-notices.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFESTS = [
  { label: 'repo root', path: join(ROOT, 'package.json'), modules: join(ROOT, 'node_modules') },
  { label: 'server', path: join(ROOT, 'server', 'package.json'), modules: join(ROOT, 'server', 'node_modules') },
];

const GROUP_ORDER = ['MIT', 'ISC', 'BSD', 'Apache', 'CC', '0BSD', 'Unlicense', 'WTFPL', 'UNLICENSED'];
const COPYLEFT = /(GPL|AGPL|LGPL)/i;

function licenseOf(depPkg) {
  const raw = depPkg.license;
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw.type) return raw.type; // legacy {type: "MIT"}
  return String(raw);
}

function groupKey(lic) {
  const up = String(lic || '').toUpperCase();
  if (COPYLEFT.test(up)) return 'COPYLEFT (GPL family)';
  for (const g of GROUP_ORDER) {
    if (up.includes(g.toUpperCase())) return g;
  }
  return 'OTHER / NON-STANDARD';
}

const entries = []; // { name, version, license, scope, source, dev, missing }

for (const { label, path, modules } of MANIFESTS) {
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  const deps = [
    ...Object.keys(pkg.dependencies ?? {}).map((n) => [n, false]),
    ...Object.keys(pkg.devDependencies ?? {}).map((n) => [n, true]),
  ];
  for (const [name, dev] of deps) {
    const depPkgPath = join(modules, name, 'package.json');
    let lic = null;
    let version = null;
    if (existsSync(depPkgPath)) {
      try {
        const depPkg = JSON.parse(readFileSync(depPkgPath, 'utf8'));
        lic = licenseOf(depPkg);
        version = depPkg.version ?? null;
      } catch {
        lic = null; // unreadable package.json — treat as undeclared
      }
    }
    entries.push({ name, version, license: lic, scope: label, dev, missing: lic == null });
  }
}

// Dedupe by name+scope (a package may be both dep and devDep).
const seen = new Map();
for (const e of entries) {
  const key = `${e.scope}:${e.name}`;
  const prev = seen.get(key);
  if (!prev || (prev.dev && !e.dev)) seen.set(key, e); // keep the runtime occurrence
}
const depsList = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));

const groups = new Map();
for (const e of depsList) {
  const key = e.missing ? 'NO LICENSE DECLARED' : groupKey(e.license);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(e);
}

const count = (pred) => depsList.filter(pred).length;
const total = depsList.length;
const devCount = count((e) => e.dev);
const copyleft = depsList.filter((e) => !e.missing && COPYLEFT.test(e.license));
const undeclared = depsList.filter((e) => e.missing);

const lines = [];
lines.push('# THIRD_PARTY_NOTICES.md — Dependency Licenses (Phase 9 F)');
lines.push('');
lines.push(`Aggregated from \`package.json\` (repo root) and \`server/package.json\` — each
dependency's own declared \`license\` field as installed in \`node_modules\`.
Nothing here is invented: declarations missing from the installed packages are
explicitly flagged. Generated ${new Date().toISOString().slice(0, 10)} by
\`scripts/phase9-f-notices.mjs\` (re-runnable).`);
lines.push('');
lines.push(`**Totals: ${total} dependencies (root + server, deduped per manifest; ${devCount} dev-only).**`);
lines.push('');
lines.push('| Group | Count |');
lines.push('|-------|-------|');
for (const [key, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`| ${key} | ${list.length} |`);
}
lines.push('');

if (copyleft.length > 0) {
  lines.push('> ## ⚠️ COPYLEFT ALERT — GPL-family licenses present');
  lines.push('>');
  lines.push('> These licenses can affect distribution of any binary/bundle that');
  lines.push('> includes them. Review before shipping:');
  lines.push('>');
  for (const e of copyleft) {
    lines.push(`> - **${e.name}** (${e.scope}) — ${e.license}${e.dev ? ' *(dev-only)*' : ''}`);
  }
  lines.push('');
} else {
  lines.push('> **No GPL/AGPL/LGPL (copyleft) licenses detected** in either manifest —');
  lines.push('> no copyleft distribution obligations found in declared licenses.');
  lines.push('');
}

if (undeclared.length > 0) {
  lines.push('## ⚠️ Dependencies with NO license declaration');
  lines.push('');
  for (const e of undeclared) {
    lines.push(`- **${e.name}** (${e.scope}) — no \`license\` field in its installed package.json${e.dev ? ' *(dev-only)*' : ''}`);
  }
  lines.push('');
}

for (const [key, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  if (key === 'NO LICENSE DECLARED') continue;
  lines.push(`## ${key} — ${list.length}`);
  lines.push('');
  lines.push('| Package | Version | Scope | Declared license |');
  lines.push('|---------|---------|-------|------------------|');
  for (const e of list) {
    lines.push(`| ${e.name}${e.dev ? ' *(dev)*' : ''} | ${e.version ?? '?'} | ${e.scope} | ${e.license} |`);
  }
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('Per-source DATA license table: see [DATA_SOURCES.md](DATA_SOURCES.md).');
lines.push('Repository code license (MIT + data carve-out): see [LICENSE](LICENSE).');

const out = join(ROOT, 'THIRD_PARTY_NOTICES.md');
const { writeFileSync } = await import('node:fs');
writeFileSync(out, lines.join('\n') + '\n');
console.log(`written: ${out}`);
console.log(`totals: ${total} deps, groups: ${[...groups.keys()].join(', ')}`);
console.log(`copyleft: ${copyleft.length}, undeclared: ${undeclared.length}`);
