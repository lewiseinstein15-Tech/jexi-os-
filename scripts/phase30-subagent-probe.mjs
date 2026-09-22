#!/usr/bin/env node
/** Phase 30 Scope C live probe: additive subagent contract fields (P1-P7). */
import nodeAssert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import subagent from '../harness/parity/subagent/index.js';

const [remoteSpecsPath, remoteRef, remoteBlob] = process.argv.slice(2);
nodeAssert.ok(remoteSpecsPath, 'remote Phase 13 specs path argument is required');
nodeAssert.ok(remoteRef, 'remote Phase 13 ref argument is required');
nodeAssert.ok(remoteBlob, 'remote Phase 13 blob argument is required');
const remoteBytes = fs.readFileSync(remoteSpecsPath);
const actualBlob = createHash('sha1')
  .update(`blob ${remoteBytes.length}\0`)
  .update(remoteBytes)
  .digest('hex');
nodeAssert.equal(actualBlob, remoteBlob, 'remote Phase 13 fixture blob must match API metadata');
const remoteCatalog = JSON.parse(remoteBytes.toString('utf8'));
nodeAssert.ok(Array.isArray(remoteCatalog.agents), 'remote Phase 13 catalog must contain agents[]');
nodeAssert.equal(remoteCatalog.count, remoteCatalog.agents.length);
const phase13Agents = [...remoteCatalog.agents]
  .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  .map((agent) => ({ ...agent, origin: 'agency-agents' }));
const base = phase13Agents[0];

function extension(spec) {
  return {
    allowedTools: spec.allowedTools,
    maxTurns: spec.maxTurns,
    permissionMode: spec.permissionMode,
    isolation: spec.isolation,
    background: spec.background,
    memory: spec.memory,
    skills: spec.skills,
  };
}

function capture(run) {
  try {
    return { returned: run() };
  } catch (error) {
    return {
      error: {
        name: error.name,
        code: error.code,
        message: error.message,
        agentId: error.agentId,
        tool: error.tool,
        maxTurns: error.maxTurns,
        turns: error.turns,
        permissionMode: error.permissionMode,
      },
    };
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

console.log('P1 ADDITIVE EXTENSION AND PHASE 13 DEFAULTS');
const explicit = subagent.extendSpec({
  ...base,
  allowedTools: ['Read', 'Write(/docs/**)'],
  maxTurns: 4,
  permissionMode: 'acceptEdits',
  isolation: 'worktree',
  background: true,
  memory: 'project',
  skills: ['superpowers:tdd'],
});
const defaulted = subagent.extendSpec(base);
const p1 = {
  explicit: {
    id: explicit.id,
    fields: extension(explicit),
    validation: subagent.validate(explicit),
  },
  phase13WithoutNewFields: {
    id: defaulted.id,
    fields: extension(defaulted),
    validation: subagent.validate(base),
  },
};
console.log(JSON.stringify(p1, null, 2));
nodeAssert.deepEqual(p1.explicit.validation, { valid: true });
nodeAssert.deepEqual(p1.phase13WithoutNewFields.validation, { valid: true });
nodeAssert.deepEqual(extension(defaulted), {
  allowedTools: [],
  maxTurns: 10,
  permissionMode: 'default',
  isolation: 'none',
  background: false,
  memory: 'none',
  skills: [],
});
console.log('P1 PASS');

console.log('\nP2 TOOL OUTSIDE ALLOWEDTOOLS');
const p2 = capture(() => subagent.enforce(
  { ...base, allowedTools: ['Read'] },
  { tool: 'Bash', arg: 'echo denied', turn: 1 },
));
console.log(JSON.stringify(p2, null, 2));
nodeAssert.equal(p2.error?.code, 'E_TOOL_NOT_ALLOWED');
nodeAssert.match(p2.error.message, /Bash/);
console.log('P2 PASS');

console.log('\nP3 MAXTURNS ENFORCEMENT');
const p3 = capture(() => subagent.enforce(
  { ...base, allowedTools: ['Read'], maxTurns: 2 },
  { tool: 'Read', arg: '/docs/a.md', turn: 3 },
));
console.log(JSON.stringify(p3, null, 2));
nodeAssert.equal(p3.error?.code, 'E_MAX_TURNS');
nodeAssert.equal(p3.error.maxTurns, 2);
nodeAssert.equal(p3.error.turns, 3);
console.log('P3 PASS');

console.log('\nP4 PLAN MODE REFUSES WRITE TOOLS');
const p4 = capture(() => subagent.enforce(
  { ...base, allowedTools: ['Write'], permissionMode: 'plan' },
  { tool: 'Write', arg: '/docs/plan.md', turn: 1 },
));
console.log(JSON.stringify(p4, null, 2));
nodeAssert.equal(p4.error?.code, 'E_TOOL_NOT_ALLOWED');
nodeAssert.equal(p4.error.tool, 'Write');
nodeAssert.equal(p4.error.permissionMode, 'plan');
nodeAssert.match(p4.error.message, /permissionMode "plan"/);
console.log('P4 PASS');

console.log('\nP5 SKILL PRELOAD LIST');
const preloaded = subagent.extendSpec({ ...base, skills: ['superpowers:tdd'] });
const p5 = { id: preloaded.id, preloadedSkills: preloaded.skills };
console.log(JSON.stringify(p5, null, 2));
nodeAssert.deepEqual(preloaded.skills, ['superpowers:tdd']);
nodeAssert.deepEqual(subagent.validate(preloaded), { valid: true });
console.log('P5 PASS');

console.log('\nP6 REMOTE PHASE 13 BACKWARD COMPATIBILITY');
const loaded = phase13Agents.map((agent) => subagent.extendSpec(agent));
const verdicts = loaded.map((agent) => ({ id: agent.id, verdict: subagent.validate(agent) }));
const invalid = verdicts.filter(({ verdict }) => !verdict.valid);
const p6 = {
  sourceRef: remoteRef,
  sourcePath: 'workforce/agents/vendor/agency-agents.specs.json',
  sourceBlob: remoteBlob,
  loaderProjection: 'origin=agency-agents',
  remoteCatalogCount: remoteCatalog.count,
  sampled: verdicts.length,
  valid: verdicts.length - invalid.length,
  invalid: invalid.length,
  sampleIds: loaded.slice(0, 8).map((agent) => agent.id),
};
console.log(JSON.stringify(p6, null, 2));
nodeAssert.equal(verdicts.length, 279);
nodeAssert.deepEqual(invalid, []);
nodeAssert.ok(loaded.every((agent) => JSON.stringify(extension(agent)) === JSON.stringify({
  allowedTools: [],
  maxTurns: 10,
  permissionMode: 'default',
  isolation: 'none',
  background: false,
  memory: 'none',
  skills: [],
})));
console.log('P6 PASS');

console.log('\nP7 DETERMINISM');
const deterministicSpec = { ...base, allowedTools: ['Read'], maxTurns: 3 };
const deterministicDispatch = { tool: 'Read', arg: '/docs/a.md', turn: 2 };
const first = JSON.stringify(subagent.enforce(deterministicSpec, deterministicDispatch));
const second = JSON.stringify(subagent.enforce(deterministicSpec, deterministicDispatch));
const p7 = {
  first,
  second,
  firstBytes: Buffer.byteLength(first),
  secondBytes: Buffer.byteLength(second),
  firstSha256: sha256(first),
  secondSha256: sha256(second),
  byteIdentical: first === second,
};
console.log(JSON.stringify(p7, null, 2));
nodeAssert.equal(first, second);
console.log('P7 PASS');

console.log('\nPHASE30_SCOPE_C_PASS');
