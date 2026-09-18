#!/usr/bin/env node
/**
 * JEXI OS — UNIVERSAL SKILL INSTALLER — install.js (Phase 12 Scope G).
 *
 * Pushes JEXI's skills (default source: skills/library/) into external
 * harnesses — the same 14 targets as the Phase 7H cross-harness adapters,
 * consumed (not rewritten) from harness/adapters/index.js.
 *
 *   node install.js --list
 *   node install.js --dry-run
 *   node install.js --harness claude-code
 *   node install.js --all-detected
 *   node install.js --uninstall claude-code
 *   [--source <dir>] [--root <home-override>]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, detect, getTarget, homeRoot } from './detect.js';
import { discoverSkills } from './convert.js';
import { install, uninstall, installedReport } from './write.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--harness' || a === '--uninstall' || a === '--source' || a === '--root') args[a.slice(2)] = argv[++i];
    else if (a === '--all-detected' || a === '--dry-run' || a === '--list') args[a.slice(2)] = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = args.root || homeRoot();
const source = path.resolve(args.source || path.join(REPO_ROOT, 'skills', 'library'));

if (args.help) {
  console.log(`JEXI universal skill installer

  --list                 show installed skills per harness
  --dry-run              plan only — no writes
  --harness <id>         install to one harness (ids: see --list output of detect)
  --all-detected         install to every detected harness
  --uninstall <id>       remove files this installer wrote for a harness
  --source <dir>         skills source tree (default: skills/library)
  --root <dir>           home override for sandboxed installs`);
  process.exit(0);
}

const skills = discoverSkills(source);
const all = detect(root);

if (args.list) {
  const report = all.map((t) => installedReport(t, { root }));
  console.log(JSON.stringify({ root, source, sourceSkills: skills.length, harnesses: report }, null, 2));
  process.exit(0);
}

if (args.uninstall) {
  const target = getTarget(args.uninstall, root);
  if (!target) { console.error(`UNKNOWN_HARNESS: '${args.uninstall}'`); process.exit(2); }
  const result = uninstall(target, { root });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.removed ? 0 : 1);
}

const chosen = args.harness
  ? [getTarget(args.harness, root)].filter(Boolean)
  : args['all-detected'] || args['dry-run']
    ? all.filter((t) => t.detected)
    : null;

if (!chosen || chosen.length === 0) {
  console.log(JSON.stringify({
    error: chosen ? 'NO_HARNESS_DETECTED' : 'NO_TARGET',
    hint: chosen
      ? `no harness config dirs found under ${root} — create one (e.g. ${all[0]?.dir}) or pass --root <dir>`
      : `unknown harness '${args.harness}' — known ids: ${all.map((t) => t.id).join(', ')}`,
    detected: all.filter((t) => t.detected).map((t) => t.id),
  }, null, 2));
  process.exit(2);
}

const results = chosen.map((t) => install(t, skills, { root, source, dryRun: !!args['dry-run'] }));
console.log(JSON.stringify({
  root,
  source,
  sourceSkills: skills.length,
  dryRun: !!args['dry-run'],
  detected: all.filter((t) => t.detected).map((t) => ({ id: t.id, evidence: t.evidence })),
  results: results.map(({ actions, ...r }) => r),
  ...(args['dry-run'] ? { samplePlan: results[0]?.actions.slice(0, 3).map(({ skill, absPath, sha256: h, state }) => ({ skill, absPath, sha256: h.slice(0, 12) + '…', state })) } : {}),
}, null, 2));
const wrote = results.some((r) => !r.dryRun);
process.exit(wrote ? 0 : 0);
