#!/usr/bin/env node
// scripts/phase25-scope-d.mjs
// Phase 25 — Scope D live probe: tool description block + budget.
// Zero dependencies. Real schemas from real files (read-only import).
// Prints raw evidence per check. Exit 1 on any failure.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { tools, render, budget, select, defaultCatalog, renderToolText, TOOL_BUDGET_RATIO, PER_TOOL_WARNING_RATIO } from '../prompt/tools/index.js';
import { listTools } from '../server/src/tools/registry/ToolRegistry.js';
import { PromptError, isPromptError } from '../prompt/assembly/errors.js';
import { createSectionRegistry } from '../prompt/assembly/registry.js';
import { CANONICAL_SECTIONS, registerCanonical } from '../prompt/assembly/order.js';
import { compute as computeBoundary } from '../prompt/assembly/boundary.js';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name, ok, evidence) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`        ${evidence}`);
  if (!ok) failures += 1;
}
function expectCode(fn) {
  try {
    fn();
    return { threw: false, got: null, err: null };
  } catch (err) {
    return { threw: true, got: err?.code ?? null, err };
  }
}
function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

console.log('=== SCOPE D PROBE — tool description block + budget ===');
console.log(`node ${process.version}`);
console.log('');

// ---------------------------------------------------------------------------
// Bootstrap: REAL tool sources, READ-ONLY import. Any domain that cannot be
// imported is reported NOT VERIFIED — never faked.
// ---------------------------------------------------------------------------
const DOMAIN_SOURCES = [
  { domain: 'filesystem',    url: '../server/src/tools/domains/filesystem/index.js',    register: 'registerFilesystemTools' },
  { domain: 'terminal',      url: '../server/src/tools/domains/terminal/index.js',      register: 'registerTerminalTools' },
  { domain: 'git',           url: '../server/src/tools/domains/git/index.js',           register: 'registerGitTools' },
  { domain: 'github',        url: '../server/src/tools/domains/github/index.js',        register: 'registerGithubTools' },
  { domain: 'memory',        url: '../server/src/tools/domains/memory/index.js',        register: 'registerMemTools' },
  { domain: 'communication', url: '../server/src/tools/domains/communication/index.js', register: 'registerCommunicationTools' },
  { domain: 'data',          url: '../server/src/tools/domains/data/index.js',          register: 'registerDataTools' },
  { domain: 'testing',       url: '../server/src/tools/domains/testing/index.js',       register: 'registerTestingTools' },
  { domain: 'browser',       url: '../server/src/tools/domains/browser/index.js',       register: 'registerBrowserTools' },
  { domain: 'lsp',           url: '../server/src/tools/domains/lsp/index.js',           register: 'registerLspTools' },
  { domain: 'web',           url: '../server/src/tools/domains/web/index.js',           register: 'registerWebTools' },
  { domain: 'delegation',    url: '../server/src/tools/domains/delegation/index.js',    register: 'registerDelegationTools' },
  { domain: 'cbm (phase 11)', url: '../tools/domains/lsp/index.js',                     register: 'registerCbmTools' },
];

const verifiedDomains = [];
const notVerifiedDomains = [];
for (const src of DOMAIN_SOURCES) {
  try {
    const mod = await import(src.url);
    mod[src.register]();
    verifiedDomains.push(src.domain);
  } catch (err) {
    notVerifiedDomains.push({ domain: src.domain, error: `${err.constructor.name}: ${String(err.message).split('\n')[0]}` });
  }
}

const load = tools.loadToolRegistry({ listTools });
const catalogIds = defaultCatalog.ids();

console.log(`--- SOURCE VERIFICATION (real files, read-only import) ---`);
console.log(`verified domains (${verifiedDomains.length}): ${verifiedDomains.join(', ')}`);
console.log(`NOT VERIFIED domains (${notVerifiedDomains.length}):`);
for (const nv of notVerifiedDomains) console.log(`  - ${nv.domain}: ${nv.error}`);
console.log(`real ToolRegistry listTools() -> ${load.registered} definitions`);
console.log(`prompt catalog size: ${defaultCatalog.size()}`);
console.log('');

// --- P1: render 3 real tools ---
const P1_IDS = ['fs_read', 'term_execute', 'git_status'];
const p1 = render(P1_IDS);
const p1Ok =
  p1.toolCount === 3 &&
  p1.dropped.length === 0 &&
  p1.charCount === p1.block.length &&
  P1_IDS.every((id) => defaultCatalog.has(id));
check(
  'P1 render([fs_read, term_execute, git_status]) -> block + toolCount=3 + dropped=[]',
  p1Ok,
  `toolCount=${p1.toolCount}; charCount=${p1.charCount}; dropped=${JSON.stringify(p1.dropped)}; ` +
  `catalog proven: ${P1_IDS.map((id) => `${id}<-${defaultCatalog.get(id).source ?? 'catalog'}`).join(', ')}\n` +
  `--- BLOCK BEGIN ---\n${p1.block}\n--- BLOCK END ---`,
);

// --- P2: block format (markdown pattern grep) ---
const headingLines = [...p1.block.matchAll(/^### [a-z][a-z0-9_-]*$/gm)].map((m) => m[0]);
const headingLiteralW = [...p1.block.matchAll(/^### \w+$/gm)].map((m) => m[0]);
const paramsLines = [...p1.block.matchAll(/^- \*\*params\*\*: /gm)].length;
const returnsLines = [...p1.block.matchAll(/^- \*\*returns\*\*: /gm)].length;
const riskLines = [...p1.block.matchAll(/^- \*\*risk\*\*: (low|medium|high|critical)$/gm)].length;
const p2Ok = headingLines.length === 3 && headingLiteralW.length === 3 && paramsLines === 3 && returnsLines === 3 && riskLines === 3;
check(
  'P2 block format: every tool has heading + params + returns + risk',
  p2Ok,
  `^### \\w+$ matches: ${headingLiteralW.length} ${JSON.stringify(headingLiteralW)}; ` +
  `^- \\*\\*params\\*\\* matches: ${paramsLines}; returns: ${returnsLines}; risk: ${riskLines}`,
);

// --- P3: budget fits + per-tool 10% warning (WARNING, not drop) ---
const b10k = budget(p1.block, 10_000);
const b1k = budget(p1.block, 1_000);
const r1k = render(P1_IDS, { promptBudget: 1_000 });
const p3Ok =
  b10k.fits === true && b10k.budgetChars === 5500 && b10k.usedPct === Math.round((b10k.usedChars / 5500) * 10000) / 100 &&
  b10k.warning === undefined &&
  b1k.fits === true && typeof b1k.warning === 'string' &&
  r1k.dropped.length === 0 && r1k.toolCount === 3 && r1k.block === p1.block;
check(
  'P3 budget(block, 10_000) fits; per-tool >10% -> WARNING not drop',
  p3Ok,
  `TOOL_BUDGET_RATIO=${TOOL_BUDGET_RATIO} PER_TOOL_WARNING_RATIO=${PER_TOOL_WARNING_RATIO}\n` +
  `budget(block, 10_000) = ${JSON.stringify(b10k)}\n` +
  `budget(block, 1_000)  = ${JSON.stringify(b1k)}\n` +
  `render(ids, {promptBudget: 1_000}).dropped = ${JSON.stringify(r1k.dropped)} (block byte-identical to P1: ${r1k.block === p1.block})`,
);

// --- P4: budget overflow -> atomic drop, reported ---
const P4_IDS = [
  'fs_read', 'fs_write', 'fs_glob', 'fs_grep', 'fs_ls',
  'term_execute', 'term_session',
  'git_status', 'git_diff', 'git_commit', 'git_branch', 'git_log',
  'gh_pr_create', 'gh_pr_review', 'gh_issue_list',
  'mem_store', 'mem_recall', 'mem_forget',
  'comm_notify', 'comm_ask',
];
const P4_BUDGET = 1600;
const p4 = render(P4_IDS, { promptBudget: P4_BUDGET });
const p4BudgetChars = tools.toolBudgetChars(P4_BUDGET);
const keptIds = [...p4.block.matchAll(/^### ([a-z][a-z0-9_-]*)$/gm)].map((m) => m[1]);
const droppedIds = p4.dropped.map((d) => d.id);
const sortedIds = (arr) => [...arr].sort();

// independent cross-check: iterative drop-from-tail (different algorithm
// than the module's prefix-fit) must produce the same drop set
function expectedDrop(ids, priorities, budgetChars) {
  const ordered = [...ids].sort((a, b) =>
    ((priorities?.[b] ?? defaultCatalog.get(b).priority) - (priorities?.[a] ?? defaultCatalog.get(a).priority)) ||
    (a < b ? -1 : a > b ? 1 : 0));
  const texts = ordered.map((id) => renderToolText(defaultCatalog.get(id)));
  const dropped = [];
  while (texts.length > 0 && texts.join('\n').length > budgetChars) {
    const removed = ordered.pop();
    texts.pop();
    dropped.unshift({ id: removed, reason: 'budget-exceeded' });
  }
  return dropped;
}
const p4Expected = expectedDrop(P4_IDS, undefined, p4BudgetChars);

const stanzas = p4.block.split(/(?=^### )/m).filter((s) => s.startsWith('### '));
const stanzasAtomic = stanzas.length === p4.toolCount && stanzas.every((s) => {
  const lines = s.replace(/\n$/, '').split('\n');
  return lines.length === 5 &&
    lines[2].startsWith('- **params**: ') &&
    lines[3].startsWith('- **returns**: ') &&
    lines[4].startsWith('- **risk**: ');
});
const keptAtomic = keptIds.every((id) => p4.block.includes(renderToolText(defaultCatalog.get(id))));
const p4Ok =
  P4_IDS.every((id) => defaultCatalog.has(id)) &&
  p4.dropped.length > 0 &&
  p4.dropped.every((d) => typeof d.id === 'string' && d.reason === 'budget-exceeded') &&
  JSON.stringify(sortedIds(droppedIds)) === JSON.stringify(sortedIds(p4Expected.map((d) => d.id))) &&
  p4.toolCount === keptIds.length &&
  keptIds.length + droppedIds.length === P4_IDS.length &&
  keptAtomic && stanzasAtomic &&
  p4.charCount <= p4BudgetChars;
check(
  `P4 render(20 real tools, {promptBudget: ${P4_BUDGET}}) -> overflow drops lowest-priority, atomic, reported`,
  p4Ok,
  `toolBudgetChars=${p4BudgetChars}; kept=${p4.toolCount} ${JSON.stringify(keptIds)}; dropped=${p4.dropped.length}\n` +
  `dropped[] raw (removal sequence, lowest-priority first): ${JSON.stringify(p4.dropped)}\n` +
  `independent iterative-drop cross-check matches (same drop set): ${JSON.stringify(sortedIds(droppedIds)) === JSON.stringify(sortedIds(p4Expected.map((d) => d.id)))}\n` +
  `every kept tool renders FULLY (verbatim stanza present): ${keptAtomic}; every stanza 5 complete lines: ${stanzasAtomic}; ` +
  `charCount ${p4.charCount} <= budgetChars ${p4BudgetChars}`,
);

// --- P5: explicit priorities drive the drop order ---
const P5_IDS = ['fs_read', 'fs_write', 'term_execute', 'git_commit', 'mem_forget', 'comm_ask', 'fs_glob', 'git_log'];
const P5_PRIORITIES = { fs_read: 90, term_execute: 80, git_commit: 70, fs_write: 60, mem_forget: 50, comm_ask: 40, fs_glob: 20, git_log: 10 };
const P5_BUDGET = 1200;
const p5 = render(P5_IDS, { promptBudget: P5_BUDGET, priorities: P5_PRIORITIES });
const p5Kept = [...p5.block.matchAll(/^### ([a-z][a-z0-9_-]*)$/gm)].map((m) => m[1]);
const p5DroppedIds = p5.dropped.map((d) => d.id);
const prio = (id) => P5_PRIORITIES[id];
const minKeptPrio = Math.min(...p5Kept.map(prio));
const maxDroppedPrio = p5DroppedIds.length > 0 ? Math.max(...p5DroppedIds.map(prio)) : -Infinity;
const droppedPrios = p5DroppedIds.map(prio);
const ascendingDrops = droppedPrios.every((p, i) => i === 0 || p >= droppedPrios[i - 1]);
const p5Expected = expectedDrop(P5_IDS, P5_PRIORITIES, tools.toolBudgetChars(P5_BUDGET));
const p5Ok =
  p5.dropped.length > 0 &&
  minKeptPrio > maxDroppedPrio &&
  ascendingDrops &&
  JSON.stringify(sortedIds(p5DroppedIds)) === JSON.stringify(sortedIds(p5Expected.map((d) => d.id))) &&
  p5Kept.length + p5DroppedIds.length === P5_IDS.length;
check(
  `P5 explicit priorities -> lowest-priority dropped first`,
  p5Ok,
  `priorities=${JSON.stringify(P5_PRIORITIES)}; promptBudget=${P5_BUDGET} (toolBudgetChars=${tools.toolBudgetChars(P5_BUDGET)})\n` +
  `kept (priority order): ${JSON.stringify(p5Kept)}; minKeptPrio=${minKeptPrio}\n` +
  `dropped (in removal sequence): ${JSON.stringify(p5DroppedIds)}; priorities ${JSON.stringify(droppedPrios)}; maxDroppedPrio=${maxDroppedPrio}\n` +
  `drop sequence ascending in priority (lowest dropped first): ${ascendingDrops}; independent cross-check matches (same drop set): ${JSON.stringify(sortedIds(p5DroppedIds)) === JSON.stringify(sortedIds(p5Expected.map((d) => d.id)))}`,
);

// --- P6: determinism (same process) ---
const p6a = render(P1_IDS);
const p6b = render(P1_IDS);
const s6a = select({ allowedTools: P4_IDS }, P4_BUDGET);
const s6b = select({ allowedTools: P4_IDS }, P4_BUDGET);
const p6Ok =
  p6a.block === p6b.block &&
  sha256(p6a.block) === sha256(p6b.block) &&
  JSON.stringify(s6a) === JSON.stringify(s6b) &&
  JSON.stringify(s6a.toolIds) === JSON.stringify(s6b.toolIds);
check(
  'P6 determinism: same render twice -> byte-identical; same select twice -> identical toolIds',
  p6Ok,
  `render sha256 x2: ${sha256(p6a.block)} / ${sha256(p6b.block)}; equal=${p6a.block === p6b.block}\n` +
  `select({allowedTools: 20 ids}, ${P4_BUDGET}) toolIds: ${JSON.stringify(s6a.toolIds)}; select JSON identical: ${JSON.stringify(s6a) === JSON.stringify(s6b)}`,
);

// --- P7: cross-process determinism (fresh process, fresh module graph) ---
const CHILD_CODE = `
import { createHash } from 'node:crypto';
import { registerFilesystemTools } from '${pathToFileURL(path.join(WT, 'server/src/tools/domains/filesystem/index.js')).href}';
import { registerTerminalTools } from '${pathToFileURL(path.join(WT, 'server/src/tools/domains/terminal/index.js')).href}';
import { registerGitTools } from '${pathToFileURL(path.join(WT, 'server/src/tools/domains/git/index.js')).href}';
import { listTools } from '${pathToFileURL(path.join(WT, 'server/src/tools/registry/ToolRegistry.js')).href}';
import { render, createToolCatalog, loadToolRegistry } from '${pathToFileURL(path.join(WT, 'prompt/tools/index.js')).href}';
registerFilesystemTools();
registerTerminalTools();
registerGitTools();
const catalog = createToolCatalog();
loadToolRegistry({ listTools }, { catalog });
const r = render(['fs_read', 'term_execute', 'git_status'], { catalog });
console.log(JSON.stringify({
  sha256: createHash('sha256').update(r.block, 'utf8').digest('hex'),
  charCount: r.charCount,
  toolCount: r.toolCount,
}));
`;
const child = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD_CODE], { encoding: 'utf8' });
let childJson = null;
try {
  childJson = JSON.parse(child.stdout.trim().split('\n').pop());
} catch { /* leave null — reported raw below */ }
const p7Ok =
  child.status === 0 &&
  childJson !== null &&
  childJson.sha256 === sha256(p6a.block) &&
  childJson.charCount === p6a.block.length;
check(
  'P7 cross-process determinism: fresh process renders the same 3 tools byte-identically',
  p7Ok,
  `child exit=${child.status}; child stdout (raw): ${child.stdout.trim()}\n` +
  `parent sha256: ${sha256(p6a.block)}; parent charCount: ${p6a.block.length}; match: ${childJson?.sha256 === sha256(p6a.block)}${child.stderr ? `\nchild stderr: ${child.stderr.trim()}` : ''}`,
);

// --- P8: agent allow-list respected ---
const p8 = select({ allowedTools: ['fs_read'] }, 10_000);
const p8b = select({ allowedTools: ['fs_read', 'git_status'] }, 10_000);
const p8Ok =
  JSON.stringify(p8.toolIds) === '["fs_read"]' &&
  p8.dropped.length === 0 &&
  JSON.stringify(p8b.toolIds) === '["fs_read","git_status"]';
check(
  'P8 agent allow-list respected by select()',
  p8Ok,
  `select({allowedTools:['fs_read']}, 10_000) = ${JSON.stringify(p8)}\n` +
  `select({allowedTools:['fs_read','git_status']}, 10_000) = ${JSON.stringify(p8b)}`,
);

// --- P9: unknown tool -> specific error, no partial output ---
const sizeBefore = defaultCatalog.size();
const r9a = expectCode(() => render(['nonexistent_tool']));
const r9b = expectCode(() => render(['fs_read', 'nonexistent_tool']));
const p9Ok =
  r9a.threw && r9a.got === 'E_UNKNOWN_TOOL' &&
  isPromptError(r9a.err, 'E_UNKNOWN_TOOL') &&
  JSON.stringify(r9a.err.details.unknown) === '["nonexistent_tool"]' &&
  r9b.threw && r9b.got === 'E_UNKNOWN_TOOL' &&
  JSON.stringify(r9b.err.details.unknown) === '["nonexistent_tool"]' &&
  defaultCatalog.size() === sizeBefore;
check(
  "P9 render(['nonexistent_tool']) -> E_UNKNOWN_TOOL, no partial output",
  p9Ok,
  `solo: threw=${r9a.threw} code=${r9a.got} details=${JSON.stringify(r9a.err?.details)}\n` +
  `mixed ['fs_read','nonexistent_tool']: threw=${r9b.threw} code=${r9b.got} (all-or-nothing: even the known tool is not rendered)\n` +
  `catalog unchanged: size ${sizeBefore} -> ${defaultCatalog.size()}`,
);

// --- P10: registry integration — the block feeds canonical section `actions` ---
const actionsSpec = CANONICAL_SECTIONS.find((s) => s.id === 'actions');
// Wiring A (production shape): downstream layer replaces the canonical
// passthrough builder for `actions` with the tool-block renderer — the
// same non-mutating substitution order.js documents for scope builders.
const wiredRegistry = createSectionRegistry();
for (const section of CANONICAL_SECTIONS) {
  wiredRegistry.register(section.id === 'actions' ? { ...section, build: () => p1.block } : section);
}
const builtSections = wiredRegistry.list().map((s) => ({ id: s.id, kind: s.kind, content: s.build({}) }));
const boundary = computeBoundary(builtSections);
const staticText = builtSections.filter((s) => s.kind === 'static').map((s) => s.content).join('\n');
const blockInsideStatic = staticText.includes(p1.block);
// Wiring B (zero-code alternative): the canonical ctx-passthrough already
// accepts the block through ctx — no server touch, no spec mutation.
const canonicalRegistry = registerCanonical();
const passthrough = canonicalRegistry.get('actions').build({ actions: p1.block });
const canonicalBudget = actionsSpec.budget.maxChars;
const p10Ok =
  actionsSpec !== undefined &&
  actionsSpec.order === 5 && actionsSpec.kind === 'static' &&
  wiredRegistry.size() === 10 &&
  builtSections.find((s) => s.id === 'actions').content === p1.block &&
  boundary.valid === true &&
  blockInsideStatic &&
  passthrough === p1.block &&
  p1.charCount <= canonicalBudget;
check(
  'P10 registry integration: tool block inserts into canonical section `actions` (order 5, static)',
  p10Ok,
  `canonical target: id=actions, label="${actionsSpec.label}", order=${actionsSpec.order}, kind=${actionsSpec.kind}, budget.maxChars=${canonicalBudget}\n` +
  `wiring A: fresh Scope A registry, actions build() replaced with () => tools.render(...).block (no spec mutation, no server touch); registry.size=${wiredRegistry.size()}\n` +
  `wiring B: canonical passthrough consumes ctx too: registerCanonical().get('actions').build({actions: block}) === block -> ${passthrough === p1.block}\n` +
  `built actions content === p1 block: ${builtSections.find((s) => s.id === 'actions').content === p1.block}; Scope B boundary over built sections: valid=${boundary.valid} staticEnd=${boundary.staticEnd} staticCharCount=${boundary.staticCharCount} cacheKey=${boundary.cacheKey}\n` +
  `tool block inside static block: ${blockInsideStatic}; block charCount ${p1.charCount} <= canonical actions budget ${canonicalBudget}\n` +
  `composition note: Scope C's CONSTITUTION_SECTION_MAP also routes escalation content to 'actions'; both are contributors to the same canonical section — composition belongs to the assembly layer (later scope), the section id is authoritative here.`,
);

console.log('');
console.log(`=== SCOPE D PROBE: ${10 - failures}/10 PASS, ${failures} FAIL ===`);
process.exit(failures > 0 ? 1 : 0);
