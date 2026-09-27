#!/usr/bin/env node
/**
 * P10 GAP 4 — P30.C PER-TOOL-CALL ENFORCEMENT — acceptance test.
 *
 * Spec:
 *   T1: child with allowedTools=["read_file"], attempt bash → E_TOOL_NOT_ALLOWED.
 *   T2: child with maxTurns=3, run 4 steps → halt at 3.
 *   T3: child with permissionMode=readonly, attempt a write tool → refused.
 *
 * Children are spawned through the REAL AgentLoop (the same loop
 * SubagentRuntime drives), with the P30.C contract threaded exactly as the
 * coordinator threads it. Deterministic scripted tool calls flow through the
 * SAME runToolCalls path as model-emitted calls — the contract gate and the
 * real gated executeTool are identical either way, so refusals are proven
 * keylessly and the allowed calls execute FOR REAL.
 */
import { runAgentLoop } from '../server/src/services/AgentLoop.js';

const baseContract = {
  id: 'jexi-agentic-test-1',
  name: 'agentic-step-1',
  division: 'operations',
  role: 'execute the step for this turn',
  capabilities: ['reasoning'],
  trustLevel: 'restricted',
  origin: 'agentic-decision-lane',
  allowedTools: [],
  maxTurns: 10,
  permissionMode: 'default',
};

const makeContract = (over) => ({ ...baseContract, id: `jexi-agentic-test-${Math.random().toString(36).slice(2, 6)}`, ...over });

let pass = 0, total = 0;
const record = (ok, label, detail) => {
  total++;
  if (ok) pass++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}`);
  console.log(`  ${detail}`);
};

/* T1 — allowedTools=["read_file"], attempt bash → E_TOOL_NOT_ALLOWED */
{
  const contract = makeContract({ allowedTools: ['read_file'] });
  const res = await runAgentLoop({
    query: 'contract enforcement probe T1',
    opts: {
      subagentContract: contract,
      __scriptedToolCalls: [
        { name: 'read_file', args: { path: 'package.json' } },   // allowed by the contract
        { name: 'bash', args: { command: 'echo pwned' } },        // NOT allowed → must be refused
      ],
    },
    sendEvent: () => {},
  });
  const ctx = res.__toolContextSnapshot || null;
  const stats = res.stats || {};
  const v = stats.contractViolations || [];
  const bashRefused = v.some((x) => x.tool === 'bash' && x.code === 'E_TOOL_NOT_ALLOWED');
  const readFileAllowed = v.every((x) => x.tool !== 'read_file');
  const answerText = String(res.answer || '');
  const ok = bashRefused && readFileAllowed && v.length === 1 && /E_TOOL_NOT_ALLOWED/.test(answerText);
  record(ok, 'T1 allowedTools=["read_file"] — bash refused E_TOOL_NOT_ALLOWED',
    `violations: ${JSON.stringify(v)} | allowedCallPassedGate: ${readFileAllowed} | answer: ${JSON.stringify(answerText.slice(0, 160))}`);
}

/* T1b — positive control: the allowed tool executes FOR REAL */
{
  const contract = makeContract({ allowedTools: ['fs_read'] });
  const res = await runAgentLoop({
    query: 'contract enforcement positive control',
    opts: {
      subagentContract: contract,
      __scriptedToolCalls: [{ name: 'fs_read', args: { path: 'package.json' } }],
    },
    sendEvent: () => {},
  });
  const stats = res.stats || {};
  const v = stats.contractViolations || [];
  const reallyRan = /"ok"\s*:\s*true/.test(String(res.answer || '')) && /"result"\s*:/.test(String(res.answer || '')) && v.length === 0;
  record(reallyRan, 'T1b allowed call (fs_read) executed FOR REAL inside the gate',
    `violations: ${JSON.stringify(v)} | answer head: ${JSON.stringify(String(res.answer || '').slice(0, 140))}`);
}

/* T2 — maxTurns=3, 4 steps → halt at 3 */
{
  const contract = makeContract({ allowedTools: ['fs_read'], maxTurns: 3 });
  const res = await runAgentLoop({
    query: 'contract enforcement probe T2',
    opts: {
      subagentContract: contract,
      __scriptedToolCalls: [
        { name: 'fs_read', args: { path: 'package.json' } },
        { name: 'fs_read', args: { path: 'README.md' } },
        { name: 'fs_read', args: { path: 'AGENTS.md' } },
        { name: 'fs_read', args: { path: 'LICENSE' } },   // turn 4 > maxTurns 3 → refused
      ],
    },
    sendEvent: () => {},
  });
  const stats = res.stats || {};
  const v = stats.contractViolations || [];
  const maxTurnsRefusal = v.find((x) => x.code === 'E_MAX_TURNS');
  const ok = Boolean(maxTurnsRefusal) && maxTurnsRefusal.turn === 4 && stats.toolCalls === 3 && v.length === 1;
  record(ok, 'T2 maxTurns=3 — 4 steps halt at 3 (turn 4 refused E_MAX_TURNS)',
    `toolCalls executed: ${stats.toolCalls} (want 3) | violations: ${JSON.stringify(v)}`);
}

/* T3 — permissionMode=readonly, write tool refused */
{
  const contract = makeContract({ allowedTools: ['fs_read', 'fs_write'], permissionMode: 'readonly' });
  const res = await runAgentLoop({
    query: 'contract enforcement probe T3',
    opts: {
      subagentContract: contract,
      __scriptedToolCalls: [
        { name: 'fs_read', args: { path: 'package.json' } },                       // read allowed in readonly
        { name: 'fs_write', args: { path: 'p10-t3-probe.txt', content: 'x' } },    // write → refused
      ],
    },
    sendEvent: () => {},
  });
  const stats = res.stats || {};
  const v = stats.contractViolations || [];
  const writeRefused = v.find((x) => x.tool === 'fs_write' && x.code === 'E_TOOL_NOT_ALLOWED');
  const readOk = v.every((x) => x.tool !== 'fs_read');
  const noFileWritten = !await (async () => { try { const fs = await import('node:fs'); const s = await fs.promises.stat('server/p10-t3-probe.txt').catch(() => null); return !!s; } catch { return false; } })();
  const ok = Boolean(writeRefused) && readOk && stats.contract?.permissionMode === 'readonly' && noFileWritten;
  record(ok, 'T3 permissionMode=readonly — write tool refused, read allowed',
    `violations: ${JSON.stringify(v)} | contract reported: ${JSON.stringify(stats.contract || null)} | file written: ${!noFileWritten}`);
}

console.log(`\nP10 GAP 4 SUB-AGENT ENFORCEMENT TEST: ${pass}/${total} PASS`);
process.exit(pass === total ? 0 : 1);
