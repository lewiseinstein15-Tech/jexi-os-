/**
 * JEXI OS — Phase 8 Scope A: PHASE 1/5 — PRE-RECON (source analysis).
 *
 * Shannon phase 1. Static analysis of the target's source tree BEFORE any
 * packet is sent. Produces an inventory (files, loc, frameworks) and a set
 * of *hypotheses* (dangerous patterns seen in source) that later phases
 * verify against the live app. Nothing here touches the network.
 *
 * Contract:
 *   id:      'pre-recon'
 *   inputs:  ['source.root']
 *   outputs: ['artifacts/pre-recon.json', 'artifacts/pre-recon.md']
 */

import fs from 'node:fs';
import path from 'node:path';
import * as store from '../orchestration/checkpoint.js';

export const phase = {
  id: 'pre-recon',
  inputs: ['source.root'],
  outputs: ['artifacts/pre-recon.json', 'artifacts/pre-recon.md'],

  async *run(ctx) {
    const { sourceRoot } = ctx;
    if (!sourceRoot || !fs.existsSync(sourceRoot)) {
      throw new Error(`pre-recon: source root not found: ${sourceRoot}`);
    }
    yield { type: 'log', data: { message: `analyzing source tree: ${sourceRoot}` } };

    const files = collectFiles(sourceRoot);
    const inventory = { files: [], totalFiles: 0, totalLoc: 0, totalBytes: 0, extensions: {} };
    const hypotheses = [];
    let hid = 0;

    for (const file of files) {
      const rel = path.relative(sourceRoot, file);
      const raw = fs.readFileSync(file, 'utf8');
      const lines = raw.split('\n');
      const ext = path.extname(file) || '(none)';
      inventory.totalFiles += 1;
      inventory.totalLoc += lines.length;
      inventory.totalBytes += Buffer.byteLength(raw);
      inventory.extensions[ext] = (inventory.extensions[ext] || 0) + 1;
      inventory.files.push({ path: rel, loc: lines.length, bytes: Buffer.byteLength(raw) });

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineno = i + 1;
        for (const rule of SOURCE_RULES) {
          if (!rule.test.test(line)) continue;
          hypotheses.push({
            id: `H-${String(++hid).padStart(3, '0')}`,
            rule: rule.id,
            class: rule.owasp,
            file: rel,
            line: lineno,
            excerpt: line.trim().slice(0, 160),
            note: rule.note,
          });
          yield { type: 'log', data: { message: `hypothesis ${hid}: ${rule.id} at ${rel}:${lineno}` } };
        }
      }
    }

    const frameworks = detectFrameworks(sourceRoot, files);
    const artifact = {
      phase: 'pre-recon',
      generatedAt: new Date().toISOString(),
      sourceRoot: path.resolve(sourceRoot),
      inventory,
      frameworks,
      hypotheses,
      hypothesisCount: hypotheses.length,
    };

    // persist hypotheses into the checkpoint — downstream phases read them
    // from here (durability), artifact remains the human-facing copy
    ctx.checkpoint.partial = { ...ctx.checkpoint.partial, hypotheses };

    const jsonPath = store.writeArtifact(ctx.stateRoot, ctx.engagementId, 'pre-recon.json', artifact);
    const mdPath = store.writeArtifact(ctx.stateRoot, ctx.engagementId, 'pre-recon.md', renderMd(artifact));

    yield { type: 'progress', data: { message: `inventory: ${inventory.totalFiles} files, ${inventory.totalLoc} loc, ${hypotheses.length} hypotheses` } };
    yield { type: 'artifact', data: { path: jsonPath, kind: 'source-analysis' } };
    yield { type: 'artifact', data: { path: mdPath, kind: 'source-analysis' } };
  },

  /** Deterministic re-entry: static analysis is idempotent. */
  async *resume(checkpointId, ctx) {
    yield { type: 'log', data: { message: `resume(${checkpointId}): re-running static analysis (idempotent, no network)` } };
    yield* this.run(ctx);
  },
};

function collectFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(js|mjs|cjs|ts|json|html|py|md)$/.test(entry.name)) out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

const SOURCE_RULES = [
  { id: 'string-concat-query', owasp: 'A03:2021 Injection', test: /['"`](SELECT|INSERT|UPDATE|DELETE)[^'"`]*['"`]\s*\+|query\s*\+|id\s*\+\s*['"`]/i, note: 'query string built by concatenation' },
  { id: 'raw-html-echo', owasp: 'A03:2021 Injection (XSS)', test: /(res\.(write|end)|innerHTML)\s*\(?\s*[`'"][^'"]*\$\{/i, note: 'request-derived value interpolated into HTML response' },
  { id: 'fs-path-from-input', owasp: 'A01:2021 Broken Access Control', test: /readFile(Sync)?\s*\([^)]*(req|query|file|path)/i, note: 'filesystem read fed by externally-controlled path' },
  { id: 'admin-route-no-guard', owasp: 'A01:2021 Broken Access Control', test: /['"`]\/admin['"`]|admin\s*(panel|route|page)/i, note: 'admin surface — check for auth guard' },
  { id: 'hardcoded-secret', owasp: 'A02:2021 Cryptographic Failures', test: /(password|secret|api[_-]?key|token)\s*[:=]\s*['"`][^'"`]{6,}['"`]/i, note: 'hardcoded credential-looking literal' },
  { id: 'no-security-headers', owasp: 'A05:2021 Security Misconfiguration', test: /setHeader\(\s*['"`](Content-Security-Policy|X-Frame-Options|Strict-Transport-Security)/i, note: 'inverse signal: any header set at all is recorded' },
  { id: 'weak-session', owasp: 'A07:2021 Identification & Authentication Failures', test: /(session|token)\s*=\s*['"`][a-z0-9]{1,12}['"`]/i, note: 'short predictable session literal' },
];

function detectFrameworks(sourceRoot, files) {
  const signals = [];
  const pkg = path.join(sourceRoot, 'package.json');
  if (fs.existsSync(pkg)) {
    try {
      const deps = JSON.parse(fs.readFileSync(pkg, 'utf8')).dependencies || {};
      signals.push(...Object.keys(deps));
    } catch { /* unreadable package.json is itself a signal but not a security one */ }
  }
  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const [name, re] of Object.entries(FW_SIGNATURES)) {
      if (re.test(src) && !signals.includes(name)) signals.push(name);
    }
  }
  return signals;
}

const FW_SIGNATURES = {
  'node:http': /require\(['"]node?:http['"]\)|from ['"]node?:http['"]/,
  'express': /require\(['"]express['"]\)|from ['"]express['"]/,
  'fs-sync-io': /readFileSync|writeFileSync/,
};

function renderMd(a) {
  const lines = [
    `# Pre-recon source analysis — ${a.sourceRoot}`,
    ``,
    `Generated: ${a.generatedAt}`,
    ``,
    `## Inventory`,
    ``,
    `- files: ${a.inventory.totalFiles}`,
    `- total LOC: ${a.inventory.totalLoc}`,
    `- bytes: ${a.inventory.totalBytes}`,
    `- extensions: ${Object.entries(a.inventory.extensions).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    `- framework signals: ${a.frameworks.join(', ') || '(none)'}`,
    ``,
    `## Hypotheses (${a.hypotheses.length})`,
    ``,
    `| id | class | rule | location | note |`,
    `|----|-------|------|----------|------|`,
    ...a.hypotheses.map((h) => `| ${h.id} | ${h.class} | ${h.rule} | ${h.file}:${h.line} | ${h.note} |`),
    ``,
  ];
  return lines.join('\n');
}

export default phase;
