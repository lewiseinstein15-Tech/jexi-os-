#!/usr/bin/env node
/**
 * JEXI OS — PHASE 13 SCOPE B — LIVE PROBE.
 *
 *   node scripts/phase13-scope-b.mjs
 *
 * Probes the 18-division registry against the real divisions.json and the
 * Scope A roster. Exit 0 = all pass.
 *
 *   P1  load 18 divisions, counts() sums to the roster size
 *   P2  members('engineering'), get('engineering')
 *   P3  assign -> transfer moves membership, total unchanged
 *   P4  named refusals: E_UNKNOWN_DIVISION x3, E_UNKNOWN_AGENT
 *   P5  unassign drops the count, re-assign restores it
 *   P6  determinism: two loads byte-identical
 *   P7  zone check: only workforce/divisions/** and scripts/phase13-*.mjs
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { createDivisionRegistry, ERRORS } from '../agents/workforce/divisions/index.js';
import { createRegistry as createAgentRegistry } from '../agents/workforce/agents/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`[PASS] ${m}`); };
const no = (m) => { fail += 1; console.log(`[FAIL] ${m}`); };
const head = (m) => console.log(`\n── ${m} ──`);
const caught = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const roster = createAgentRegistry().load();
const divisions = createDivisionRegistry();
const list = divisions.load();

head('P1 load() -> 18 divisions, counts() sums to roster size');
console.log(`divisions.load().length: ${list.length}`);
for (const d of list) console.log(`  ${d.id}  ${d.name}`);
const counts = divisions.counts();
console.log('counts():', JSON.stringify(counts, null, 1));
const sum = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`sum(counts) = ${sum}`);
console.log(`Scope A roster count = ${roster.count}`);
console.log(`divisions.assignedCount() = ${divisions.assignedCount()}`);
if (list.length === 18) ok(`P1a loaded ${list.length} divisions`);
else no(`P1a expected 18 divisions, got ${list.length}`);
if (sum === roster.count) ok(`P1b sum(counts) ${sum} == roster ${roster.count}`);
else no(`P1b sum(counts) ${sum} != roster ${roster.count}`);
if (divisions.assignedCount() === roster.count) ok('P1c assignedCount() == roster count');
else no(`P1c assignedCount() ${divisions.assignedCount()} != roster ${roster.count}`);
console.log('load errors:', divisions.errors().length);

head("P2 members('engineering') + get('engineering')");
const engMembers = divisions.members('engineering');
console.log(`members('engineering').length: ${engMembers.length}`);
console.log('first 10 ids:', JSON.stringify(engMembers.slice(0, 10).map((a) => a.id)));
console.log('last 3 ids:', JSON.stringify(engMembers.slice(-3).map((a) => a.id)));
const eng = divisions.get('engineering');
console.log('get(engineering):', JSON.stringify({
  id: eng.id, name: eng.name, purpose: eng.purpose, agentCount: eng.agentCount, capabilities: eng.capabilities,
}));
if (engMembers.length === counts.engineering && eng.agentCount === counts.engineering) ok(`P2 members('engineering') and get().agentCount agree (${eng.agentCount})`);
else no('P2 members/get disagree on engineering count');
const sorted = JSON.stringify(engMembers.map((a) => a.id)) === JSON.stringify([...engMembers.map((a) => a.id)].sort());
if (sorted) ok('P2b members are sorted by id');
else no('P2b members are not sorted by id');

head('P3 assign -> transfer moves the membership, total unchanged');
const subject = 'architect';
const before = divisions.get(divisions.members('engineering').some((a) => a.id === subject) ? 'engineering' : 'security');
console.log(`subject: ${subject}`);
const fromDiv = 'engineering';
const toDiv = 'security';
const wasInFrom = divisions.members(fromDiv).some((a) => a.id === subject);
const wasInTo = divisions.members(toDiv).some((a) => a.id === subject);
console.log(`before: in ${fromDiv}=${wasInFrom}, in ${toDiv}=${wasInTo}, engineering=${counts[fromDiv]}, security=${counts[toDiv]}`);
const res = divisions.assign(subject, toDiv);
console.log('assign() result:', JSON.stringify(res));
const nowInFrom = divisions.members(fromDiv).some((a) => a.id === subject);
const nowInTo = divisions.members(toDiv).some((a) => a.id === subject);
const counts2 = divisions.counts();
console.log(`after: in ${fromDiv}=${nowInFrom}, in ${toDiv}=${nowInTo}, engineering=${counts2[fromDiv]}, security=${counts2[toDiv]}`);
const sum2 = Object.values(counts2).reduce((a, b) => a + b, 0);
console.log(`sum(counts) after = ${sum2}`);
if (!nowInFrom && nowInTo) ok('P3a transfer removed the old membership and added the new one');
else no(`P3a transfer wrong: inFrom=${nowInFrom} inTo=${nowInTo}`);
if (sum2 === roster.count) ok(`P3b total unchanged at ${sum2}`);
else no(`P3b total changed to ${sum2}`);
if (res.transferred === true && res.from === fromDiv && res.to === toDiv) ok('P3c assign reports from/to/transferred');
else no('P3c assign did not report the transfer');
// restore for later probes
divisions.assign(subject, fromDiv);

head('P4 named refusals');
const e1 = caught(() => divisions.assign('architect', 'not-a-division'));
console.log('assign(known agent, unknown division):', e1 && JSON.stringify({ name: e1.name, code: e1.code, message: e1.message }));
if (e1 && e1.code === ERRORS.UNKNOWN_DIVISION) ok('P4a assign unknown division -> E_UNKNOWN_DIVISION');
else no(`P4a got ${e1 && e1.code}`);
const e2 = caught(() => divisions.assign('no-such-agent', 'security'));
console.log('assign(unknown agent, known division):', e2 && JSON.stringify({ name: e2.name, code: e2.code, message: e2.message }));
if (e2 && e2.code === ERRORS.UNKNOWN_AGENT) ok('P4b assign unknown agent -> E_UNKNOWN_AGENT');
else no(`P4b got ${e2 && e2.code}`);
const e3 = caught(() => divisions.members('not-a-division'));
console.log("members('not-a-division'):", e3 && JSON.stringify({ name: e3.name, code: e3.code, message: e3.message }));
if (e3 && e3.code === ERRORS.UNKNOWN_DIVISION) ok('P4c members unknown division -> E_UNKNOWN_DIVISION');
else no(`P4c got ${e3 && e3.code}`);
const e4 = caught(() => divisions.get('not-a-division'));
console.log("get('not-a-division'):", e4 && JSON.stringify({ name: e4.name, code: e4.code, message: e4.message }));
if (e4 && e4.code === ERRORS.UNKNOWN_DIVISION) ok('P4d get unknown division -> E_UNKNOWN_DIVISION');
else no(`P4d got ${e4 && e4.code}`);

head('P5 unassign drops the count, re-assign restores it');
const target = 'zola';
const divOfZola = divisions.get('engineering') && Object.keys(counts).find((d) => divisions.members(d).some((a) => a.id === target));
console.log(`subject: ${target}, currently in: ${divOfZola}`);
const baseSum = Object.values(divisions.counts()).reduce((a, b) => a + b, 0);
const u = divisions.unassign(target);
console.log('unassign() result:', JSON.stringify(u));
const afterUnassign = Object.values(divisions.counts()).reduce((a, b) => a + b, 0);
console.log(`sum(counts) after unassign = ${afterUnassign}`);
if (afterUnassign === baseSum - 1) ok(`P5a unassign removed one membership (${baseSum} -> ${afterUnassign})`);
else no(`P5a expected ${baseSum - 1}, got ${afterUnassign}`);
const re = divisions.assign(target, divOfZola);
console.log('re-assign() result:', JSON.stringify(re));
const afterRe = Object.values(divisions.counts()).reduce((a, b) => a + b, 0);
console.log(`sum(counts) after re-assign = ${afterRe}`);
if (afterRe === roster.count) ok(`P5b re-assign restored the total to ${afterRe}`);
else no(`P5b expected ${roster.count}, got ${afterRe}`);
const e5 = caught(() => divisions.unassign('no-such-agent'));
console.log('unassign(unknown agent):', e5 && JSON.stringify({ name: e5.name, code: e5.code }));
if (e5 && e5.code === ERRORS.UNKNOWN_AGENT) ok('P5c unassign unknown agent -> E_UNKNOWN_AGENT');
else no(`P5c got ${e5 && e5.code}`);

head('P6 determinism: two loads byte-identical');
const a = createDivisionRegistry();
const b = createDivisionRegistry();
const listA = a.load();
const listB = b.load();
const idsA = JSON.stringify(listA.map((d) => d.id));
const idsB = JSON.stringify(listB.map((d) => d.id));
const memA = JSON.stringify(listA.map((d) => a.members(d.id).map((x) => x.id)));
const memB = JSON.stringify(listB.map((d) => b.members(d.id).map((x) => x.id)));
const capA = JSON.stringify(listA.map((d) => a.get(d.id).capabilities));
const capB = JSON.stringify(listB.map((d) => b.get(d.id).capabilities));
console.log('division id lists identical:', idsA === idsB);
console.log('member orderings identical:', memA === memB);
console.log('capability unions identical:', capA === capB);
if (idsA === idsB && memA === memB && capA === capB) ok('P6 two loads are byte-identical');
else no('P6 loads differ');

head('P7 zone check: git status --short');
const status = execFileSync('git', ['status', '--short'], { cwd: REPO, encoding: 'utf8' }).trim();
console.log(status || '(clean)');
const lines = status.split('\n').filter(Boolean);
const allowedPath = /^(workforce\/divisions\/|scripts\/phase13-.*\.mjs$)/;
const stray = lines.filter((l) => !allowedPath.test(l.replace(/^(.{1,2})\s+/, '')));
const inZone = stray.length === 0;
if (inZone) ok(`P7 all ${lines.length} changed paths are in zone`);
else no(`P7 out-of-zone paths: ${JSON.stringify(stray)}`);

console.log('\n=============================');
console.log(`SCOPE B PROBE: ${pass} PASS / ${fail} FAIL`);
console.log('=============================');
process.exit(fail === 0 ? 0 : 1);