#!/usr/bin/env node
/**
 * JEXI OS — CONSOLIDATED CLEANUP — credential-invariant grep helper.
 *
 * One uniform, token-boundary credential sweep for every gate. Replaces the
 * old naive `sk-[a-z0-9]` pattern that false-positived on ordinary words
 * ("ta sk- t ype" / task-type, "ri sk- a voidance" / risk-avoidance,
 * "di sk- c ache" / disk-cache) and on vendored prose mentioning "LLM".
 *
 * Patterns (all anchored at a non-word boundary on the left):
 *   P1  provider token shapes   ghp_…, github_pat_…, sk-…, AKIA…, xox…-…
 *   P2  PEM private key blocks  -----BEGIN … PRIVATE KEY-----
 *   P3  credential assignments  password/secret/api_key/token/… = "literal"
 *   P4  network/LLM call sites  fetch( / axios / openai / anthropic as tokens
 *
 * Exit 0 = no hits (clean). Exit 1 = hits printed (gate must classify).
 * Usage:
 *   node scripts/cleanup-creds-grep.mjs <path>...      # default: whole repo
 *   node scripts/cleanup-creds-grep.mjs --selftest    # known-cases proof
 */
import { execFileSync } from 'node:child_process';

const PATTERNS = [
  { id: 'P1-credential-shaped-strings', re: String.raw`(^|[^a-zA-Z])(ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|sk-[a-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})` },
  { id: 'P2-private-key-blocks', re: String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----` },
  { id: 'P3-credential-assignment-literals', re: String.raw`(?i)(password|passwd|secret|api[_-]?key|access[_-]?token|auth[-_]?token|bearer)[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9+/_-]{8,}['\"]` },
  { id: 'P4-network-llm-call-sites', re: String.raw`fetch\(|axios|openai|anthropic` },
];

const args = process.argv.slice(2);
const selftest = args.includes('--selftest');
const paths = selftest ? [] : args.filter((a) => !a.startsWith('--'));

function sweep(pattern, targets) {
  // POSIX ERE has no inline (?i); hoist it to the -i flag.
  const flagI = pattern.startsWith('(?i)');
  if (flagI) pattern = pattern.slice(4);
  const argv = ['grep', '-nE', '-e', pattern, '--', ...targets]; // -e: patterns may start with '-' (PEM blocks)
  if (flagI) argv.splice(1, 0, '-i');
  try {
    const out = execFileSync('git', argv, { encoding: 'utf8' });
    return { hits: out.trim().split('\n').filter(Boolean), clean: false };
  } catch (e) {
    if (e.status === 1) return { hits: [], clean: true }; // git grep: 1 = no match
    throw e;
  }
}

if (selftest) {
  // Known false-positive corpus from real phases + true positives per pattern.
  // Each case line gets its own temp fixture file; every pattern is run
  // against it; expected NO-HIT proves the token boundary, expected HIT
  // proves the sweep still catches real shapes.
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const cases = [
    ['the 6.2 task-type matrix drives routing', false],
    ['risk-avoidance and disk-cache warm paths', false],
    ['LLM Post-Training Engineer prose mentions llms.txt', false],
    ['see docs/task-type-and-risk-based-models', false],
    ['token = readEnv(MADTEA_PROBE_TOKEN)', false],
    // True-positive shapes are assembled at runtime so this source file never
    // contains a credential-shaped literal (it would trip its own sweep).
    ['ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3', true],
    ['sk-' + 'x'.repeat(30), true],
    ['password = ' + String.fromCharCode(34) + 'hunter2hunter2' + String.fromCharCode(34), true],
    ['-----BEGIN ' + 'RSA PRIVATE KEY' + '-----', true],
    ['await fetch(url)', true],
  ];
  const dir = mkdtempSync(path.join(os.tmpdir(), 'creds-grep-selftest-'));
  let pass = 0, fail = 0;
  for (const [line, expectHit] of cases) {
    const fp = path.join(dir, 'case.txt');
    writeFileSync(fp, line + '\n');
    let anyHit = false;
    for (const { id, re } of PATTERNS) {
      const r = spawnSync('grep', ['-nE', '-e', re.replace(/^\(\?i\)/, ''), fp], { encoding: 'utf8' });
      if (r.status === 0) { anyHit = true; if (!expectHit) { fail++; console.log(`  MISMATCH [${id}] expected NO-HIT: "${line}"`); } }
    }
    if (expectHit && !anyHit) { fail++; console.log(`  MISMATCH expected HIT, got NO-HIT: "${line.slice(0, 18)}…"`,); }
    if (expectHit === anyHit) pass++;
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`SELFTEST: ${pass} PASS / ${fail} FAIL (10 known cases: 5 false-positive corpus + 5 true shapes)`);
  process.exit(fail ? 1 : 0);
}

const targets = paths.length ? paths : ['.'];
let dirty = false;
for (const { id, re } of PATTERNS) {
  const r = sweep(re, targets);
  console.log(`=== ${id} ===`);
  if (r.clean) console.log('  (clean — no matches)');
  else { dirty = true; for (const h of r.hits) console.log('  ' + h); }
}
console.log(dirty ? '\nRESULT: HITS ABOVE NEED CLASSIFICATION (exit 1)' : '\nRESULT: CLEAN (exit 0)');
process.exit(dirty ? 1 : 0);
