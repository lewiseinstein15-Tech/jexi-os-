#!/usr/bin/env node
/** Phase 30 Scope D live probe: always-on and path-scoped rules (P1-P7). */
import nodeAssert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rules, { globMatch } from '../harness/parity/rules/index.js';

const [remoteRef, phase25Blob] = process.argv.slice(2);
nodeAssert.ok(remoteRef, 'authoritative remote ref argument is required');
nodeAssert.ok(phase25Blob, 'authoritative Phase 25 blob argument is required');
const phase25Path = fileURLToPath(new URL('../prompt/sections/08-instructions.js', import.meta.url));
const phase25Bytes = fs.readFileSync(phase25Path);
const actualPhase25Blob = createHash('sha1')
  .update(`blob ${phase25Bytes.length}\0`)
  .update(phase25Bytes)
  .digest('hex');
nodeAssert.equal(actualPhase25Blob, phase25Blob);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function ruleFile(frontmatter, content) {
  return `---\n${frontmatter}\n---\n${content}`;
}

function paths(result) {
  return result.rules.map((rule) => rule.path);
}

function capture(run) {
  try {
    return { returned: run() };
  } catch (error) {
    return { error: { name: error.name, code: error.code, message: error.message } };
  }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-phase30-rules-'));
try {
  const fixture = path.join(temp, 'fixture');
  write(fixture, '.claude/rules/always-high.md', ruleFile(
    'always: true\npriority: 90',
    'Always apply the highest-priority project safety rule.\n',
  ));
  write(fixture, '.claude/rules/typescript.md', ruleFile(
    "globs: ['**/*.ts', 'src/**']\npriority: 80",
    'Apply TypeScript and source-tree implementation guidance.\n',
  ));
  write(fixture, '.claude/rules/docs.md', ruleFile(
    "globs:\n  - 'docs/**'\npriority: 80",
    'Apply documentation-specific language and citation guidance.\n',
  ));
  write(fixture, '.claude/rules/always-low.md', ruleFile(
    'always: true\npriority: 40',
    'Always apply the lower-priority style rule.\n',
  ));

  console.log('P1 LOAD FOUR FIXTURE RULES');
  const loaded = rules.load(fixture);
  const p1 = loaded.map((rule) => ({ ...rule, scope: rules.scope(rule) }));
  console.log(JSON.stringify(p1, null, 2));
  nodeAssert.equal(loaded.length, 4);
  nodeAssert.equal(loaded.filter((rule) => rule.always).length, 2);
  nodeAssert.equal(loaded.filter((rule) => rule.globs.length > 0).length, 2);
  console.log('P1 PASS');

  console.log('\nP2 SESSION-START AND PATH-SCOPED INJECTION');
  const session = rules.inject();
  const typescript = rules.inject('src/foo.ts');
  const docs = rules.inject('docs/readme.md');
  const p2 = {
    sessionStart: { paths: paths(session), tokens: session.tokens, budget: session.budget },
    srcFooTs: { paths: paths(typescript), tokens: typescript.tokens, budget: typescript.budget },
    docsReadme: { paths: paths(docs), tokens: docs.tokens, budget: docs.budget },
  };
  console.log(JSON.stringify(p2, null, 2));
  nodeAssert.equal(session.budget, 4000);
  nodeAssert.equal(typescript.budget, 4000);
  nodeAssert.equal(docs.budget, 4000);
  nodeAssert.deepEqual(paths(session), [
    '.claude/rules/always-high.md',
    '.claude/rules/always-low.md',
  ]);
  nodeAssert.deepEqual(paths(typescript), [
    '.claude/rules/always-high.md',
    '.claude/rules/typescript.md',
    '.claude/rules/always-low.md',
  ]);
  nodeAssert.deepEqual(paths(docs), [
    '.claude/rules/always-high.md',
    '.claude/rules/docs.md',
    '.claude/rules/always-low.md',
  ]);
  console.log('P2 PASS');

  console.log('\nP3 TOKEN BUDGET DROPS LOWEST PRIORITY FIRST');
  const high = loaded.find((rule) => rule.path.endsWith('always-high.md'));
  const budgeted = rules.inject('src/foo.ts', { tokenBudget: high.tokens });
  console.log(JSON.stringify(budgeted, null, 2));
  nodeAssert.deepEqual(paths(budgeted), ['.claude/rules/always-high.md']);
  nodeAssert.deepEqual(budgeted.dropped.map((entry) => entry.path), [
    '.claude/rules/always-low.md',
    '.claude/rules/typescript.md',
  ]);
  nodeAssert.equal(budgeted.droppedCount, 2);
  nodeAssert.ok(budgeted.tokens <= budgeted.budget);
  console.log('P3 PASS');

  console.log('\nP4 RULE SCOPE ERRORS');
  const missingRoot = path.join(temp, 'missing-scope');
  write(missingRoot, '.claude/rules/missing.md', 'No frontmatter means no declared scope.\n');
  const ambiguousRoot = path.join(temp, 'ambiguous-scope');
  write(ambiguousRoot, '.claude/rules/ambiguous.md', ruleFile(
    "always: true\nglobs: ['**/*.ts']\npriority: 10",
    'Ambiguous rule.\n',
  ));
  const missing = capture(() => rules.load(missingRoot));
  const ambiguous = capture(() => rules.load(ambiguousRoot));
  console.log(JSON.stringify({ missing, ambiguous }, null, 2));
  nodeAssert.equal(missing.error?.code, 'E_MISSING_RULE_SCOPE');
  nodeAssert.equal(ambiguous.error?.code, 'E_AMBIGUOUS_RULE_SCOPE');
  console.log('P4 PASS');

  console.log('\nP5 DETERMINISTIC ORDERING');
  const ordered = rules.load(fixture).map((rule) => ({ path: rule.path, priority: rule.priority }));
  console.log(JSON.stringify(ordered, null, 2));
  nodeAssert.deepEqual(ordered, [
    { path: '.claude/rules/always-high.md', priority: 90 },
    { path: '.claude/rules/docs.md', priority: 80 },
    { path: '.claude/rules/typescript.md', priority: 80 },
    { path: '.claude/rules/always-low.md', priority: 40 },
  ]);
  console.log('P5 PASS');

  console.log('\nP6 GLOB MATCHER');
  const p6 = {
    typescriptMatchesTs: globMatch('**/*.ts', 'src/foo.ts'),
    typescriptMatchesJs: globMatch('**/*.ts', 'src/foo.js'),
    srcTreeMatchesNested: globMatch('src/**', 'src/a/b/c'),
  };
  console.log(JSON.stringify(p6, null, 2));
  nodeAssert.deepEqual(p6, {
    typescriptMatchesTs: true,
    typescriptMatchesJs: false,
    srcTreeMatchesNested: true,
  });
  console.log('P6 PASS');

  console.log('\nP7 DETERMINISM');
  const first = JSON.stringify({
    loaded: rules.load(fixture),
    injected: rules.inject('src/foo.ts'),
  });
  const second = JSON.stringify({
    loaded: rules.load(fixture),
    injected: rules.inject('src/foo.ts'),
  });
  const p7 = {
    firstBytes: Buffer.byteLength(first),
    secondBytes: Buffer.byteLength(second),
    firstSha256: sha256(first),
    secondSha256: sha256(second),
    byteIdentical: first === second,
  };
  console.log(JSON.stringify(p7, null, 2));
  nodeAssert.equal(first, second);
  console.log('P7 PASS');

  console.log('\nPHASE 25 AGENTS.MD BRIDGE — NO DUPLICATION');
  const agentsFixture = path.join(temp, 'phase25-agents');
  write(agentsFixture, 'AGENTS.md', 'Root Phase 25 instructions.\n');
  write(agentsFixture, 'src/AGENTS.md', 'Nested Phase 25 instructions.\n');
  write(agentsFixture, '.claude/rules/AGENTS.md', 'Rule-directory Phase 25 instructions.\n');
  const bridged = rules.load(agentsFixture);
  const bridgedPaths = bridged.map((rule) => rule.path);
  const bridge = {
    sourceRef: remoteRef,
    sourcePath: 'prompt/sections/08-instructions.js',
    sourceBlob: phase25Blob,
    loaded: bridged.length,
    unique: new Set(bridgedPaths).size,
    paths: bridgedPaths,
    sources: [...new Set(bridged.map((rule) => rule.source))],
    sessionStartPaths: paths(rules.inject()),
  };
  console.log(JSON.stringify(bridge, null, 2));
  nodeAssert.equal(bridged.length, 3);
  nodeAssert.equal(new Set(bridgedPaths).size, 3);
  nodeAssert.deepEqual(bridge.sources, ['phase25-agents']);
  nodeAssert.deepEqual(bridge.sessionStartPaths, bridgedPaths);
  console.log('PHASE25_BRIDGE_PASS');

  console.log('\nPHASE30_SCOPE_D_PASS');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
