#!/usr/bin/env node
/** Phase 30 Scope B live probe: deny-by-default skill tool scoping (P1-P7). */
import nodeAssert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import skills from '../harness/parity/skills/index.js';

function capture(run) {
  try {
    return { returned: run() };
  } catch (error) {
    return {
      error: {
        name: error.name,
        code: error.code,
        message: error.message,
        skill: error.skill,
        tool: error.tool,
      },
    };
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

console.log('P1 PARSE FOUR ALLOWED-TOOLS PATTERNS');
const p1Patterns = [
  'ToolName',
  'ToolName(arg:*)',
  'ToolName(/path/**)',
  'ToolName(exact-arg)',
];
const p1 = p1Patterns.map((pattern) => ({ pattern, ast: skills.scoping.parse(pattern) }));
console.log(JSON.stringify(p1, null, 2));
nodeAssert.deepEqual(p1.map(({ ast }) => ast), [
  { tool: 'ToolName' },
  { tool: 'ToolName', argPattern: 'arg:*' },
  { tool: 'ToolName', argPattern: '/path/**' },
  { tool: 'ToolName', argPattern: 'exact-arg' },
]);
console.log('P1 PASS');

console.log('\nP2 WILDCARD AND PATH MATCHES');
const p2 = {
  prefix: skills.scoping.matches('ToolName(arg:*)', {
    tool: 'ToolName',
    arg: 'arg:foo:bar',
  }),
  pathInside: skills.scoping.matches('ToolName(/path/**)', {
    tool: 'ToolName',
    arg: '/path/a/b',
  }),
  pathOutside: skills.scoping.matches('ToolName(/path/**)', {
    tool: 'ToolName',
    arg: '/other',
  }),
};
console.log(JSON.stringify(p2, null, 2));
nodeAssert.deepEqual(p2, { prefix: true, pathInside: true, pathOutside: false });
nodeAssert.equal(skills.scoping.matches('ToolName(/path/**)', {
  tool: 'ToolName',
  arg: '/path/../other',
}), false);
console.log('P2 PASS');

console.log('\nP3 DENY BY DEFAULT');
const p3 = capture(() => skills.enforcement.assert(
  { name: 'weather-agent-without-tools' },
  { tool: 'WebFetch', arg: 'https://weather.example' },
));
console.log(JSON.stringify(p3, null, 2));
nodeAssert.equal(p3.error?.code, 'E_TOOL_NOT_ALLOWED');
nodeAssert.match(p3.error.message, /weather-agent-without-tools/);
nodeAssert.match(p3.error.message, /WebFetch/);
console.log('P3 PASS');

console.log('\nP4 FAIL-CLOSED ALLOWLIST GUARDRAIL');
const guardedSkill = { name: 'read-only-skill', allowedTools: ['Read', 'Skill'] };
const bash = capture(() => skills.enforcement.assert(guardedSkill, {
  tool: 'Bash',
  arg: 'curl https://weather.example',
}));
const read = capture(() => skills.enforcement.assert(guardedSkill, {
  tool: 'Read',
  arg: '/docs/weather.md',
}));
const p4 = { Bash: bash, Read: read };
console.log(JSON.stringify(p4, null, 2));
nodeAssert.equal(bash.error?.code, 'E_TOOL_NOT_ALLOWED');
nodeAssert.deepEqual(read.returned, { allowed: true });
console.log('P4 PASS');

console.log('\nP5 PHASE 12 SKILL REGISTRY AUDIT');
const audit = skills.enforcement.auditPhase12();
const p5 = {
  total: audit.total,
  declaredAllowedTools: audit.declared,
  enforced: audit.enforced,
  unenforced: audit.unenforced,
  unenforcedSkills: audit.unenforcedSkills,
  registryErrors: audit.registryErrors,
};
console.log(JSON.stringify(p5, null, 2));
nodeAssert.equal(audit.total, 158);
nodeAssert.equal(audit.declared, 158);
nodeAssert.equal(audit.enforced, 158);
nodeAssert.equal(audit.unenforced, 0);
nodeAssert.deepEqual(audit.unenforcedSkills, []);
nodeAssert.deepEqual(audit.registryErrors, []);
console.log('P5 PASS');

console.log('\nP6 UNKNOWN PATTERN FAILS CLOSED');
const invalidPattern = 'ToolName(arg:**)';
const directInvalid = capture(() => skills.scoping.parse(invalidPattern));
const eagerInvalid = capture(() => skills.scoping.allowed(
  ['Read', invalidPattern],
  { tool: 'Read', arg: '/docs/a.md' },
));
console.log(JSON.stringify({ invalidPattern, directInvalid, eagerInvalid }, null, 2));
nodeAssert.equal(directInvalid.error?.code, 'E_INVALID_PATTERN');
nodeAssert.equal(eagerInvalid.error?.code, 'E_INVALID_PATTERN');
for (const malformed of ['', ' ToolName', 'ToolName()', 'ToolName(/path/*)', 'ToolName((arg))']) {
  nodeAssert.equal(capture(() => skills.scoping.parse(malformed)).error?.code, 'E_INVALID_PATTERN');
}
console.log('P6 PASS');

console.log('\nP7 DETERMINISM');
const deterministicPattern = 'Bash(agent-browser:*)';
const deterministicCall = { tool: 'Bash', arg: 'agent-browser:open:https://example.test' };
const first = JSON.stringify({
  ast: skills.scoping.parse(deterministicPattern),
  result: skills.scoping.matches(deterministicPattern, deterministicCall),
});
const second = JSON.stringify({
  ast: skills.scoping.parse(deterministicPattern),
  result: skills.scoping.matches(deterministicPattern, deterministicCall),
});
console.log(JSON.stringify({
  first,
  second,
  firstBytes: Buffer.byteLength(first),
  secondBytes: Buffer.byteLength(second),
  firstSha256: sha256(first),
  secondSha256: sha256(second),
  byteIdentical: first === second,
}, null, 2));
nodeAssert.equal(first, second);
console.log('P7 PASS');

console.log('\nPHASE30_SCOPE_B_PASS');
