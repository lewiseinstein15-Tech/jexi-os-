#!/usr/bin/env node
/**
 * ui-ux-pro-max — REAL local search over the shipped CSV dataset.
 * Ported from nextlevelbuilder/ui-ux-pro-max-skill (MIT) — upstream engine is
 * Python (scripts/search.py); this is the dependency-free Node port for JEXI.
 * No network. No deps. Data files are the ones in ../data/.
 *
 * Usage:
 *   node search.mjs "<query>" [--domain style|product|color|typography|ux|chart|landing|motion|reasoning|all] [--top N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'data');

/** Minimal RFC-4180-ish CSV parser (quoted fields, escaped double-quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] || '').trim() !== '');
}

export function loadDomain(name) {
  const files = {
    style: 'styles.csv', product: 'products.csv', color: 'colors.csv',
    typography: 'typography.csv', ux: 'ux-guidelines.csv', chart: 'charts.csv',
    landing: 'landing.csv', motion: 'motion.csv', reasoning: 'ui-reasoning.csv',
  };
  const file = files[name];
  if (!file) throw new Error(`unknown domain '${name}' — known: ${Object.keys(files).join(', ')}, all`);
  const p = path.join(DATA, file);
  const rows = parseCsv(fs.readFileSync(p, 'utf8'));
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = { _domain: name, _file: file };
    header.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    return obj;
  });
}

const STOP = new Set(['a', 'an', 'the', 'for', 'with', 'and', 'or', 'of', 'to', 'in', 'on', 'best', 'good']);

/** Score one row against query tokens: field-weighted keyword/substring match. */
export function scoreRow(row, tokens) {
  let score = 0;
  for (const [field, value] of Object.entries(row)) {
    if (field.startsWith('_') || !value) continue;
    const v = String(value).toLowerCase();
    const weight = field === 'Keywords' || field === 'Keyword' ? 3
      : /name|type|category|style|pairing|pattern/i.test(field) ? 2 : 1;
    for (const t of tokens) {
      if (v.includes(t)) score += weight * (v.startsWith(t) ? 1.5 : 1);
    }
  }
  return score;
}

export function search(query, { domain = 'all', top = 3 } = {}) {
  const domains = domain === 'all'
    ? ['style', 'product', 'color', 'typography', 'ux', 'chart', 'landing', 'motion', 'reasoning']
    : [domain];
  const tokens = String(query).toLowerCase().split(/[^a-z0-9+#.-]+/).filter((t) => t.length > 1 && !STOP.has(t));
  if (!tokens.length) throw new Error('empty query after tokenization');
  const hits = [];
  for (const d of domains) {
    for (const row of loadDomain(d)) {
      const s = scoreRow(row, tokens);
      if (s > 0) hits.push({ score: s, row });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, top);
}

// --- CLI ---
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const query = args.find((a) => !a.startsWith('--'));
  const get = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : dflt; };
  const domain = get('--domain', 'all');
  const top = parseInt(get('--top', '3'), 10);
  if (!query) { console.error('usage: node search.mjs "<query>" [--domain d] [--top N]'); process.exit(2); }
  try {
    const results = search(query, { domain, top });
    console.log(JSON.stringify({ query, domain, top, count: results.length, results }, null, 2));
  } catch (e) {
    console.error('SEARCH_ERROR:', e.message);
    process.exit(1);
  }
}
