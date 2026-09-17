/**
 * JEXI OS — Phase 7 Scope A LIVE PROBE.
 *
 * P1: project with package.json (JS/TS)  → common + typescript rules load.
 * P2: project with pyproject.toml        → common + python rules load.
 * P3: loaded rules appear in the REAL agent context — the actual
 *     JEXI_SYSTEM_PROMPT built by server/src/services/JexiPrompt.js —
 *     verified per stack via subprocess with JEXI_RULES_PROJECT_ROOT.
 *
 * Raw output only. Exit 1 on any failure.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUTDIR = process.env.PHASE7_PROBE_DIR || '/home/z/my-project/phase7-probes';
const PKG = path.join(OUTDIR, 'pkg-project');
const PY = path.join(OUTDIR, 'py-project');

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
};

function fixture(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
}

// —— fixtures (outside the repo, so the repo tree stays clean) ——
fixture(PKG, {
  'package.json': JSON.stringify({ name: 'pkg-probe', version: '0.0.1', private: true, devDependencies: { typescript: '^5.0.0' } }, null, 2),
  'tsconfig.json': '{\n  "compilerOptions": { "strict": true }\n}\n',
  'src/index.ts': 'export const answer = 42;\n',
});
fixture(PY, {
  'pyproject.toml': '[project]\nname = "py-probe"\nversion = "0.0.1"\nrequires-python = ">=3.10"\n',
  'requirements.txt': 'requests>=2.31\n',
  'app.py': 'def main() -> int:\n    return 0\n',
});

const { detectStack, loadRules, renderRulesBlock, rulesStatus } =
  await import(url.pathToFileURL(path.join(REPO, 'rules', 'loader.js')).href);

console.log('== P1: package.json (JS/TS) project → common + typescript ==');
{
  const st = rulesStatus(PKG);
  console.log('  detectStack  →', detectStack(PKG).join(', '));
  console.log('  loaded files →', st.files.join(', '), `(${st.chars} chars)`);
  const block = renderRulesBlock(loadRules(PKG));
  ok(detectStack(PKG).includes('typescript'), 'typescript stack detected from package.json + tsconfig.json');
  ok(detectStack(PKG).includes('common'), 'common stack always present');
  ok(st.files.includes('rules/common/coding-style.md'), 'common rules file loaded');
  ok(st.files.includes('rules/typescript/typescript.md'), 'typescript rules file loaded');
  ok(block.includes('JEXI-RULE common/coding-style CS-1'), 'block contains common rule string', 'CS-1');
  ok(block.includes('JEXI-RULE typescript TS-1'), 'block contains typescript rule string', 'TS-1');
  ok(!block.includes('JEXI-RULE python PY-1'), 'python rule NOT loaded for JS project (stack scoping)');
}

console.log('\n== P2: pyproject.toml project → common + python ==');
{
  const st = rulesStatus(PY);
  console.log('  detectStack  →', detectStack(PY).join(', '));
  console.log('  loaded files →', st.files.join(', '), `(${st.chars} chars)`);
  const block = renderRulesBlock(loadRules(PY));
  ok(detectStack(PY).includes('python'), 'python stack detected from pyproject.toml');
  ok(st.files.includes('rules/python/python.md'), 'python rules file loaded');
  ok(block.includes('JEXI-RULE python PY-1'), 'block contains python rule string', 'PY-1');
  ok(block.includes('JEXI-RULE common/coding-style CS-1'), 'common rule still loads alongside python', 'CS-1');
  ok(!block.includes('JEXI-RULE typescript TS-1'), 'typescript rule NOT loaded for python project (stack scoping)');
}

console.log('\n== P3: rules appear in the REAL agent context (JEXI_SYSTEM_PROMPT) ==');
{
  const probeCode = `
    const m = await import(${JSON.stringify(url.pathToFileURL(path.join(REPO, 'server', 'src', 'services', 'JexiPrompt.js')).href)});
    const p = m.JEXI_SYSTEM_PROMPT;
    const line = p.split('\\n').find((l) => l.includes('JEXI-RULE')) || '(none)';
    console.log('PROMPTCHECKS ' + JSON.stringify({
      len: p.length,
      header: p.includes('# ACTIVE RULES (JEXI rules system'),
      cs1: p.includes('JEXI-RULE common/coding-style CS-1'),
      ts1: p.includes('JEXI-RULE typescript TS-1'),
      py1: p.includes('JEXI-RULE python PY-1'),
      rc1: p.includes('JEXI-RULE react RC-1'),
      firstRuleLine: line,
    }));
  `;
  const run = (label, envRoot) => {
    const env = { ...process.env };
    if (envRoot) env.JEXI_RULES_PROJECT_ROOT = envRoot; else delete env.JEXI_RULES_PROJECT_ROOT;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', probeCode], { env, encoding: 'utf8' });
    const out = (r.stdout || '').split('\n').find((l) => l.startsWith('PROMPTCHECKS'));
    console.log(`  [${label}] ${(out || `subprocess failed: ${r.stderr && r.stderr.split('\n')[0]}`).replace('PROMPTCHECKS ', '')}`);
    return out ? JSON.parse(out.replace('PROMPTCHECKS ', '')) : null;
  };

  const repoCtx = run('default root = this repo', null);
  ok(!!repoCtx && repoCtx.header, 'REAL prompt carries the ACTIVE RULES header');
  ok(!!repoCtx && repoCtx.cs1, 'REAL prompt contains common rule string', 'CS-1');
  ok(!!repoCtx && repoCtx.rc1, 'REAL prompt contains react rule string (repo self-detects react)', 'RC-1');
  ok(!!repoCtx && !repoCtx.py1, 'REAL prompt has NO python rule for this repo (stack scoping)');

  const pkgCtx = run('JEXI_RULES_PROJECT_ROOT=pkg-project', PKG);
  ok(!!pkgCtx && pkgCtx.ts1, 'REAL prompt contains typescript rule string for pkg project', 'TS-1');
  ok(!!pkgCtx && pkgCtx.cs1, 'REAL prompt contains common rule string for pkg project', 'CS-1');
  ok(!!pkgCtx && !pkgCtx.py1, 'REAL prompt has NO python rule for pkg project');

  const pyCtx = run('JEXI_RULES_PROJECT_ROOT=py-project', PY);
  ok(!!pyCtx && pyCtx.py1, 'REAL prompt contains python rule string for py project', 'PY-1');
  ok(!!pyCtx && !pyCtx.ts1, 'REAL prompt has NO typescript rule for py project');

  if (repoCtx) console.log('  first rule line in REAL prompt →', repoCtx.firstRuleLine);
}

console.log(`\n== SCOPE A PROBE RESULT: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail === 0 ? 0 : 1);
