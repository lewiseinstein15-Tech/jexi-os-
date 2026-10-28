/**
 * JEXI OS — EVALUATION — capability-runtime category.
 *
 * The nine scenarios the agent-runtime mission calls for, as executable checks
 * against REAL subsystems (capability registry, requirement inference, tool-set
 * builder, domain executor, verification loop, evidence ledger). Keyless and
 * deterministic. Nothing here is simulated: every check either runs the real
 * code path or asserts on a real result object.
 *
 * The category exists to measure five things the old runtime could not:
 *   task completion · tool selection · execution success · verification
 *   quality · false-success claims
 *
 * Run: node evaluation/run.js   (from server/)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { buildOfferedTools } = await import('../src/services/agent/ToolSetBuilder.js');
const { domainExecutor, domainDispatch } = await import('../src/tools/domains/executor.js');
const { CodingLoop } = await import('../src/services/agent/CodingLoop.js');
const capReg = await import('../src/capability/registry/registry.js');
const { inferRequirements } = await import('../src/capability/registry/requirements.js');
const { selectCapabilityTools } = await import('../src/capability/registry/selection.js');
const ledger = await import('../src/capability/registry/ledger.js');

domainExecutor(); // boot the domain registry once

const offeredNames = async (query, plan) => {
  const out = await buildOfferedTools({ plan, query, emit: () => {} });
  return { names: out.schemas.map((s) => s.function?.name || s.name), out };
};

/** A scratch workspace so file checks never touch the repo. */
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-eval-'));

const capabilityRuntime = [
  /* ── 1. the user asks JEXI to search the web ────────────────────────── */
  {
    id: 'C1',
    task: 'user asks JEXI to search the web (classifier misroutes it to legal_task)',
    expected: 'a web-search tool is offered despite the misroute',
    tools: ['web_search'],
    constraints: 'requirement inference must not depend on the classifier',
    success: async () => {
      const { names } = await offeredNames('search the web for the latest Node.js release',
        { intent: 'legal_task', tools: ['compliance-check', 'privacy-review'] });
      return names.includes('web_search');
    },
  },

  /* ── 2. the user asks JEXI to inspect a local file ──────────────────── */
  {
    id: 'C2',
    task: 'user asks JEXI to inspect a local file',
    expected: 'fs_read is offered AND actually returns the file contents',
    tools: ['fs_read'],
    constraints: 'real byte-level read, not a simulated result',
    success: async () => {
      const { names } = await offeredNames('read the file notes.txt', { intent: 'default', tools: [] });
      if (!names.includes('fs_read')) return false;
      const p = path.join(scratch, 'notes.txt');
      fs.writeFileSync(p, 'the quick brown fox\n');
      const r = await domainDispatch('fs_read', { path: p }, { profile: 'auto', root: scratch });
      return r.ok === true && /quick brown fox/.test(String(r.result));
    },
  },

  /* ── 3. the user asks JEXI to run a harmless terminal command ───────── */
  {
    id: 'C3',
    task: 'user asks JEXI to run a harmless terminal command (echo)',
    expected: 'term_execute is offered, and the result is reported HONESTLY',
    tools: ['term_execute'],
    constraints: 'in a container without unshare the run must report the real failure, never a fake success',
    success: async () => {
      const { names } = await offeredNames('run echo hello in the terminal', { intent: 'default', tools: [] });
      if (!names.includes('term_execute')) return false;
      const r = await domainDispatch('term_execute', { command: 'echo jexi-eval' }, { profile: 'auto', root: scratch });
      // Either it really ran and produced output, or it failed with a real
      // stderr — both are honest. A success with no output would not be.
      if (r.ok === true) return /jexi-eval/.test(String(r.result?.stdout ?? r.result ?? ''));
      return Boolean(r.error) && r.ok === false;
    },
  },

  /* ── 4. a tool returns an error ─────────────────────────────────────── */
  {
    id: 'C4',
    task: 'a tool returns an error (read a file that does not exist)',
    expected: 'ok:false with a classified error, and the failure reaches the ledger',
    tools: ['fs_read'],
    constraints: 'no throw escapes to the caller; the error is structured',
    success: async () => {
      ledger._resetLedger();
      const r = await domainDispatch('fs_read', { path: path.join(scratch, 'nope-does-not-exist.txt') },
        { profile: 'auto', root: scratch });
      if (r.ok !== false || !r.error) return false;
      ledger.recordOutcome({ tool: 'fs_read', result: r });
      return ledger.failedCapabilities().has('filesystem_read');
    },
  },

  /* ── 5. a task requires multiple tool calls ─────────────────────────── */
  {
    id: 'C5',
    task: 'a task needs several capabilities at once (read + edit + test + search)',
    expected: 'every required capability is offered in one turn',
    tools: ['fs_read', 'fs_write', 'pytest_run', 'web_search'],
    constraints: 'the coding cap must not withhold an explicitly required non-coding tool',
    success: async () => {
      const { names } = await offeredNames('fix the failing test and search the web for the error message',
        { intent: 'code', tools: ['fs_read', 'fs_edit', 'pytest_run'] });
      return ['fs_read', 'pytest_run', 'web_search'].every((n) => names.includes(n));
    },
  },

  /* ── 6. a skill is installed but not registered ─────────────────────── */
  {
    id: 'C6',
    task: 'an active skill declares allowedTools that are not real tool slugs',
    expected: 'the unenforceable allowlist does not starve the turn',
    tools: ['pytest_run'],
    constraints: 'the shipped `debugging` skill lists ["read","edit","terminal.execute","testing.run"], none of which resolve',
    success: async () => {
      // This query activates the `debugging` skill, whose allowlist is prose.
      const { names, out } = await offeredNames('debug the failing test',
        { intent: 'code', tools: ['fs_read', 'fs_edit', 'pytest_run'] });
      if (out.skill?.slug !== 'debugging') return false; // the scenario must actually be in play
      // Whatever the skill says, a coding turn must still reach its tools.
      return names.includes('pytest_run') && names.includes('fs_read');
    },
  },

  /* ── 7. a tool is registered but unavailable ────────────────────────── */
  {
    id: 'C7',
    task: 'a tool is registered but blocked by the permission profile (readonly)',
    expected: 'reported registered-but-unavailable with permission_denied, not available',
    tools: [],
    constraints: 'availability must reflect the live profile, not the catalogue',
    success: async () => {
      const d = capReg.describeCapability('filesystem_write', { profile: 'readonly' });
      return d.registered === true && d.available === false && d.reason === 'permission_denied';
    },
  },

  /* ── 8. a task fails verification ───────────────────────────────────── */
  {
    id: 'C8',
    task: 'an edit is made and verification fails',
    expected: 'a structured failure is produced and the turn may not claim success',
    tools: ['fs_edit'],
    constraints: 'the failure carries the layer and reason, and is injected back',
    success: async () => {
      const loop = new CodingLoop({
        runVerify: async () => ({
          ok: false,
          context: { verified: false, injectedFailure: { layer: 'test', reason: 'pytest exited 1', evidence: [{ content: 'FAILED test_x' }] } },
          results: [{ layer: 'test', status: 'fail' }],
        }),
      });
      loop.noteToolCall('fs_edit', true);
      const v = await loop.verify('fs_edit');
      const gate = loop.successGate();
      return v.verified === false
        && v.failure && v.failure.layer === 'test'
        && gate.canClaimSuccess === false
        && gate.status === 'unverified';
    },
  },

  /* ── 9. the model claims success when execution actually failed ─────── */
  {
    id: 'C9',
    task: 'the model claims success after a failed execution',
    expected: 'the claim is refused: not succeeded in the ledger, not verified in the gate',
    tools: [],
    constraints: 'a red test verdict is not a success; a failed call does not lift the capability state',
    success: async () => {
      ledger._resetLedger();
      await capReg.primeCapabilities();

      // A test tool that "succeeded" at the transport level but returned red.
      ledger.recordOutcome({ tool: 'pytest_run', result: { ok: true, status: 'fail' } });
      if (ledger.succeededCapabilities().has('testing')) return false;
      if (!ledger.failedCapabilities().has('testing')) return false;
      if (capReg.describeCapability('testing').state === capReg.STATES.SUCCEEDED) return false;

      // And a coding turn that edited nothing green may not claim a fix.
      const loop = new CodingLoop({
        runVerify: async () => ({ ok: false, context: { injectedFailure: { layer: 'lint', reason: 'no pass' } }, results: [] }),
      });
      loop.noteToolCall('fs_edit', true);
      loop.noteTestResult('pytest_run', { ok: true, status: 'fail' });
      return loop.successGate().canClaimSuccess === false;
    },
  },

  /* ── evidence: a real success DOES lift the state ───────────────────── */
  {
    id: 'C10',
    task: 'a capability that genuinely succeeded is recorded as succeeded',
    expected: 'succeeded state reachable only from a real, non-refused success',
    tools: ['fs_read'],
    constraints: 'the positive control for C9 — the ledger is not simply always-negative',
    success: async () => {
      ledger._resetLedger();
      await capReg.primeCapabilities();
      const p = path.join(scratch, 'proof.txt');
      fs.writeFileSync(p, 'proof\n');
      const r = await domainDispatch('fs_read', { path: p }, { profile: 'auto', root: scratch });
      ledger.recordOutcome({ tool: 'fs_read', result: r });
      return ledger.succeededCapabilities().has('filesystem_read')
        && capReg.describeCapability('filesystem_read').state === capReg.STATES.SUCCEEDED;
    },
  },

  /* ── capability questions answered from the runtime ─────────────────── */
  {
    id: 'C11',
    task: 'user asks "can you search the web?"',
    expected: 'the answer comes from the registry (capability_check), not from memory',
    tools: ['capability_check'],
    constraints: 'task mode reports required capabilities and whether they are available',
    success: async () => {
      const r = await domainDispatch('capability_check', { forTask: 'search the web for the latest news' },
        { profile: 'auto' });
      if (!r.ok) return false;
      const need = r.result?.required?.find((x) => x.capability === 'web_search');
      return Boolean(need) && need.available === true && r.result.canProceed === true;
    },
  },

  /* ── an unavailable requirement is reported, not silently dropped ───── */
  {
    id: 'C12',
    task: 'a request needs a capability the profile forbids',
    expected: 'reported unavailable with a reason; canProceed=false',
    tools: ['capability_check'],
    constraints: 'the runtime must not promise work it cannot do',
    success: async () => {
      const sel = await selectCapabilityTools({
        query: 'write the file report.txt', plan: { intent: 'code', tools: [] }, profile: 'readonly',
      });
      return sel.unavailable.some((u) => u.capability === 'filesystem_write');
    },
  },

  /* ── a read-only session must NOT lose its reads ────────────────────── */
  {
    id: 'C13',
    task: 'read-only session: a safe read is still available (the false-negative direction)',
    expected: 'filesystem_read available under readonly; filesystem_write not',
    tools: ['fs_read'],
    constraints: 'domain tools report no riskLevel through resolveToolDef, so a naive default denies safe tools',
    success: async () => {
      const read = capReg.describeCapability('filesystem_read', { profile: 'readonly' });
      const write = capReg.describeCapability('filesystem_write', { profile: 'readonly' });
      const tier = read.providers.find((p) => p.tool === 'fs_read')?.tier;
      return read.available === true && tier === 'safe' && write.available === false;
    },
  },
];

export const CAPABILITY_CATEGORY = {
  name: 'capability-runtime',
  label: 'Capability runtime',
  tasks: capabilityRuntime,
};
