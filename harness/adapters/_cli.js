/**
 * JEXI OS — CROSS-HARNESS ADAPTERS — CLI runner (Phase 7 H).
 *
 * Used by scripts/convert-harnesses.sh and scripts/install-harnesses.sh:
 *
 *   node harness/adapters/_cli.js convert  [--only <id>] [--out <dir>] [--strict]
 *   node harness/adapters/_cli.js install  [--dry-run] [--only <id>] [--root <dir>] [--force]
 *
 * convert: runs every adapter's convert() and writes the output tree to
 *          /tmp/jexi-harness-<id>/ (stateless, always rewritten).
 * install: detects which harnesses exist on this machine; undetected ones
 *          are skipped CLEANLY (a dash, not a crash); detected ones get the
 *          converted files installed idempotently. --dry-run touches nothing.
 *
 * Per-file canonical errors are reported (file + reason) and do NOT abort
 * the run. --strict turns them into a nonzero exit for CI.
 */

import fs from 'fs';
import path from 'path';
import { list, get, detect, convertAll, installAll } from './index.js';

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') opts.only = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--root') opts.root = argv[++i];
    else if (a === '--strict') opts.strict = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else opts._.push(a);
  }
  return opts;
}

function kindCounts(files) {
  const counts = {};
  for (const f of files) counts[f.kind] = (counts[f.kind] || 0) + 1;
  return Object.entries(counts)
    .map(([k, n]) => `${k}${k.endsWith('s') ? '' : 's'} ${n}`)
    .join(', ');
}

/** Write a converted file tree to an arbitrary output dir (conversion sink). */
function writeTree(files, outDir) {
  for (const f of files) {
    const abs = path.join(outDir, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(f.content ?? ''), 'utf8');
  }
}

async function cmdConvert(opts) {
  const results = await convertAll({ canonical: undefined });
  const adapters = opts.only ? [get(opts.only)].filter(Boolean) : list();
  let totalFiles = 0;
  const canonErrors = results[0]?.canonical?.errors || [];

  for (const id of adapters.map((a) => a.id)) {
    const r = results.find((x) => x.id === id);
    if (!r) continue;
    if (!r.ok) {
      console.log(`✗ ${id} — convert failed: ${r.error}`);
      continue;
    }
    const outDir = opts.out && adapters.length === 1 ? opts.out : `/tmp/jexi-harness-${id}`;
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    writeTree(r.converted.files, outDir);
    totalFiles += r.converted.files.length;
    console.log(`✓ ${r.adapter.displayName} (${id}) — ${r.converted.files.length} files → ${outDir}${r.converted.files.length ? ` (${kindCounts(r.converted.files)})` : ''}`);
    for (const f of r.converted.files) {
      const bytes = Buffer.byteLength(String(f.content ?? ''), 'utf8');
      console.log(`    ${f.kind.padEnd(8)} ${f.path} (${bytes}B)`);
    }
  }

  for (const e of canonErrors) console.log(`WARN ${e.file}: ${e.error}`);
  console.log(`\nconverted: ${adapters.length} harnesses, ${totalFiles} files, ${canonErrors.length} errors`);
  if (opts.strict && canonErrors.length > 0) process.exit(1);
}

async function cmdInstall(opts) {
  const snapshot = detect();
  const targets = opts.only ? snapshot.filter((s) => s.id === opts.only) : snapshot;
  if (opts.only && targets.length === 0) {
    console.log(`✗ unknown adapter: "${opts.only}"`);
    process.exit(2);
  }

  if (opts.dryRun) console.log('DRY RUN — nothing will be written\n');
  const results = await installAll({ dryRun: !!opts.dryRun, root: opts.root, force: opts.force, only: opts.only });

  for (const t of targets) {
    const r = results.find((x) => x.id === t.id);
    if (!r) continue;
    if (r.skipped) {
      console.log(`- ${t.displayName} (${t.id}) — detected: false, skipped cleanly`);
      continue;
    }
    if (r.error) {
      console.log(`✗ ${t.displayName} (${t.id}) — install failed: ${r.error}`);
      continue;
    }
    const i = r.install;
    const mode = opts.dryRun ? 'would install' : 'installed';
    console.log(`✓ ${t.displayName} (${t.id}) — ${mode}: ${i.created} created, ${i.changed} changed, ${i.identical} identical → ${i.targetRoot}`);
    for (const p of i.paths) console.log(`    ${p.action.padEnd(13)} ${p.path}`);
  }

  const detected = targets.filter((t) => t.detected).length;
  console.log(`\ndetected: ${detected}/${targets.length} harnesses${opts.force ? ' (forced)' : ''} | install complete${opts.dryRun ? ' (dry-run, no writes)' : ''}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0] || 'convert';
  if (opts.help || !['convert', 'install'].includes(cmd)) {
    console.log('usage: _cli.js convert [--only <id>] [--out <dir>] [--strict]\n       _cli.js install [--dry-run] [--only <id>] [--root <dir>] [--force]');
    process.exit(opts.help ? 0 : 2);
  }
  if (cmd === 'convert') await cmdConvert(opts);
  else await cmdInstall(opts);
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
