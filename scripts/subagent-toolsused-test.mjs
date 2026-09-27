#!/usr/bin/env node
/**
 * P11 A4 — KEYLESS CHILDREN toolsUsed METERING test.
 *
 * BEFORE: the keyless child brain (executeCapabilityKeyless) did real work
 *         (search / file read / memory write / script exec) but never
 *         touched the loop's tool-call counter, so every keyless child
 *         reported toolsUsed: 0 (the P10 report's documented gap).
 * AFTER:  each capability runner meters its REAL primitive tool invocations
 *         (meta.toolInvocations), executeCapabilityKeyless propagates them,
 *         and AgentLoop adds them to stats.toolCalls — so SubagentRuntime's
 *         `toolCalls` and the coordinator's `toolsUsed` carry the actual
 *         count. Not a stub: the numbers come from instrumented call sites.
 *
 * Asserts (keyless, no model key needed):
 *   T1  file_read child       → toolCalls === 1  (one real read)
 *   T2  memory_write child    → toolCalls === 1  (one real store write)
 *   T3  code_run child        → toolCalls === 2  (workspace write + exec)
 *   T4  direct_answer child   → toolCalls === 0  (pure text — honest zero)
 *   T5  full dispatch chain   → AgenticDecision.dispatchSubagents(['file_read','memory_write'])
 *                             → every child result carries toolsUsed > 0
 *                             and the composition is real
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), `a4-toolsused-${Date.now()}-`));

const { runAgentLoop } = await import(path.join(ROOT, 'server/src/services/AgentLoop.js'));
const { dispatchSubagents } = await import(path.join(ROOT, 'server/src/services/AgenticDecision.js'));

const results = [];
const check = (id, ok, detail) => { results.push(ok); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`); };

// T1 — file_read child: one real file read metered
{
  const target = path.join(ROOT, 'server/package.json');
  const r = await runAgentLoop({
    query: `read the file ${target}`,
    sendEvent: () => {},
    opts: { subagentCapability: 'file_read', subagentCapabilityQuery: `read the file ${target}` },
  });
  check('T1 file_read toolsUsed', r.stats.toolCalls === 1,
    `toolCalls=${r.stats.toolCalls} (expect 1 — one real read of server/package.json) · answerHead=${JSON.stringify(r.answer.slice(0, 60))}`);
}

// T2 — memory_write child: one real store write metered
{
  const r = await runAgentLoop({
    query: 'remember that the launch codeword is heliotrope',
    sendEvent: () => {},
    opts: { subagentCapability: 'memory_write', subagentCapabilityQuery: 'remember that the launch codeword is heliotrope' },
  });
  check('T2 memory_write toolsUsed', r.stats.toolCalls === 1,
    `toolCalls=${r.stats.toolCalls} (expect 1 — one real memory store write) · observation in answer=${/heliotrope/.test(r.answer)}`);
}

// T3 — code_run child: template script → workspace write + subprocess exec = 2
{
  const r = await runAgentLoop({
    query: "what is today's date",
    sendEvent: () => {},
    opts: { subagentCapability: 'code_run', subagentCapabilityQuery: "what is today's date" },
  });
  check('T3 code_run toolsUsed', r.stats.toolCalls === 2,
    `toolCalls=${r.stats.toolCalls} (expect 2 — 1 workspace file write + 1 subprocess exec) · ran=${/Today/.test(r.answer) || /Output/.test(r.answer)}`);
}

// T4 — direct_answer (arithmetic): pure compute — HONEST zero, no fake metering
{
  const r = await runAgentLoop({
    query: 'what is 23 * 7 + 1',
    sendEvent: () => {},
    opts: { subagentCapability: 'direct_answer', subagentCapabilityQuery: 'what is 23 * 7 + 1' },
  });
  check('T4 direct_answer honest zero', r.stats.toolCalls === 0 && /162/.test(r.answer),
    `toolCalls=${r.stats.toolCalls} (expect 0 — arithmetic is compute, not a tool) · correctAnswer=${/162/.test(r.answer)}`);
}

// T5 — the FULL dispatch chain: coordinator contract → children → toolsUsed
{
  const out = await dispatchSubagents('read the file package.json at the server root and remember that toolsUsed must be metered', ['file_read', 'memory_write'], { sendEvent: () => {} });
  const perChild = (out.results || []).map((c) => ({ name: c.name, toolsUsed: c.toolsUsed }));
  const allReal = out.results.length >= 2 && out.results.every((c) => Number(c.toolsUsed) > 0);
  const fileChild = (out.results || []).find((c) => /file_read/.test(c.name));
  check('T5 dispatch chain toolsUsed', allReal,
    `children=${JSON.stringify(perChild)} (every child > 0) · composed=${JSON.stringify(out.composed && out.composed.ok)} · fileChildRealContent=${fileChild ? /package.json|Contents of/.test(fileChild.result) : false}`);
}

const pass = results.filter(Boolean).length;
console.log('──────────────────────────────────────────────');
console.log(` A4 RESULT: ${pass}/${results.length} checks PASS`);
process.exit(pass === results.length ? 0 : 1);
