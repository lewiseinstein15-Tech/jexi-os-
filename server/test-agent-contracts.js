/**
 * M3 — PROFESSIONAL AGENT CONTRACTS regression suite.
 *
 * Proves: every on-disk agent definition carries a valid contract v1
 * (required fields, kebab-case name, list-form tools validated against the
 * live tool registry, 200-char professional prompt floor); malformed
 * contracts are refused with specific errors; typos warn, never silently
 * pass; and the SubagentRuntime spawn gate blocks invalid/unknown agents
 * without ever spawning them.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-ac-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const A = await import('./src/services/AgentDefinitions.js');
const { TOOL_REGISTRY } = await import('./src/services/ToolRegistry.js');
const { resolveJobAgent, runSubagents } = await import('./src/services/SubagentRuntime.js');
const SLUGS = TOOL_REGISTRY.map((t) => t.slug);

console.log('\n== 1. All on-disk definitions carry valid contracts ==');
const all = A.validateAllAgentContracts({ toolSlugs: SLUGS });
ok(all.count === 10, `ten professional agents on disk (${all.count})`);
ok(all.valid === true, `every contract validates (${all.errors.map((e) => e.agent).join(', ') || 'no errors'})`);
for (const a of all.agents) {
  ok(a.ok && a.summary && !('systemPrompt' in a.summary), `${a.slug}: valid + summary leaks no prompt body`);
}

console.log('\n== 2. Malformed contracts are refused with specific errors ==');
const good = A.loadAgentDefinition('researcher');
ok(!!good, 'fixture definition loads');
const missing = A.validateAgentContract({ slug: 'x', meta: { ...good.meta, mission: '' }, systemPrompt: good.systemPrompt });
ok(!missing.ok && missing.errors.some((e) => e.includes('"mission"')), 'empty mission refused by name');
const kebab = A.validateAgentContract({ slug: 'x', meta: { ...good.meta, name: 'Bad Name' }, systemPrompt: good.systemPrompt });
ok(!kebab.ok && kebab.errors.some((e) => e.includes('kebab-case')), 'non-kebab name refused');
const listForm = A.validateAgentContract({ slug: 'x', meta: { ...good.meta, 'allowed-tools': 'web-search' }, systemPrompt: good.systemPrompt });
ok(!listForm.ok && listForm.errors.some((e) => e.includes('list form')), 'string allowed-tools refused (must be [a, b])');
const bogus = A.validateAgentContract({ slug: 'x', meta: { ...good.meta, 'allowed-tools': ['web-search', 'nope-not-a-tool'] }, systemPrompt: good.systemPrompt }, { toolSlugs: SLUGS });
ok(!bogus.ok && bogus.errors.some((e) => e.includes('nope-not-a-tool')), 'unknown tool slug refused by name');
const shallow = A.validateAgentContract({ slug: 'x', meta: good.meta, systemPrompt: 'do research' });
ok(!shallow.ok && shallow.errors.some((e) => e.includes(`${A.MIN_PROMPT_CHARS}`)), `shallow prompt refused (${A.MIN_PROMPT_CHARS}-char floor)`);

console.log('\n== 3. Typos and gaps warn, never silently pass ==');
const typo = A.validateAgentContract({ slug: 'x', meta: { ...good.meta, misson: 'oops' }, systemPrompt: good.systemPrompt });
ok(typo.warnings.some((w) => w.includes('misson')), 'unknown field warns (typo detection)');
const slim = { ...good.meta };
delete slim['escalate-when'];
const gap = A.validateAgentContract({ slug: 'x', meta: slim, systemPrompt: good.systemPrompt });
ok(gap.ok && gap.warnings.some((w) => w.includes('escalate-when')), 'missing recommended field warns but still spawns');

console.log('\n== 4. Spawn gate: resolveJobAgent ==');
const r1 = resolveJobAgent({ name: 'r', query: 'q', agentDef: 'researcher' });
ok(!r1.blocked && r1.def && r1.isolated === true, 'valid contract resolves (fork isolated)');
const r2 = resolveJobAgent({ name: 'x', query: 'q', agentDef: 'does-not-exist' });
ok(!!r2.blocked && r2.blocked.includes('unknown agent definition'), 'unknown agentDef blocked with reason');
const r3 = resolveJobAgent({ name: 'plain', query: 'q' });
ok(!r3.blocked && !r3.def, 'job without agentDef unaffected');

console.log('\n== 5. Spawn gate: blocked jobs fail without spawning ==');
const events = [];
const out = await runSubagents({ tasks: [{ name: 'ghost', query: 'do work', agentDef: 'does-not-exist' }], sendEvent: (t, d) => events.push(t), opts: {} });
ok(out.subagents.length === 1 && out.subagents[0].status === 'failed', 'blocked job reports failed');
ok(String(out.subagents[0].error || '').includes('unknown agent definition'), 'failure names the refused contract');
ok(!events.includes('subagent.start'), 'no spawn started for a blocked job (start never emitted)');

console.log(`\nM3 agent-contracts: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
