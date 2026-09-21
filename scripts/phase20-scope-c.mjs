#!/usr/bin/env node
/**
 * JEXI OS — Phase 20 Scope C — LIVE PROBES P1–P6 (consensus algorithms).
 *
 * Raw output only. Run: node scripts/phase20-scope-c.mjs
 * Exit 0 = all pass, 1 = any fail.
 */
import consensus from '../swarm/consensus/index.js';
import { SwarmError } from '../swarm/consensus/_internal.js';

const MEMBERS = ['node-a', 'node-b', 'node-c', 'node-d', 'node-e'];
let failures = 0;
function verdict(id, ok, msg) {
  console.log(`${id}: ${ok ? 'PASS' : 'FAIL'} — ${msg}`);
  if (!ok) failures += 1;
}
const expectError = (fn, code) => {
  try {
    fn();
    return { threw: false };
  } catch (err) {
    return { threw: err instanceof SwarmError && err.code === code, err };
  }
};

console.log('═══════════════════════════════════════════════════');
console.log('P1 — propose with each of the 5 algos (4 accept, 1 reject)');
console.log('═══════════════════════════════════════════════════');
const VOTES = { 'node-e': 'reject' };
console.log('list():', JSON.stringify(consensus.list()));
const rByz = consensus.propose('byzantine', { value: 'deploy-v2', members: MEMBERS, votes: VOTES, f: 0 });
const rRaft = consensus.propose('raft', { value: 'deploy-v2', members: MEMBERS, votes: VOTES });
const rGossip = consensus.propose('gossip', { value: 'deploy-v2', members: MEMBERS, votes: VOTES });
const rCrdt = consensus.propose('crdt', { value: 'deploy-v2', members: MEMBERS, votes: VOTES });
const rQuorum = consensus.propose('quorum', { value: 'deploy-v2', members: MEMBERS, votes: VOTES });
for (const r of [rByz, rRaft, rGossip, rCrdt, rQuorum]) {
  console.log(`${r.algo}: decision=${JSON.stringify(r.decision)} dissent=${JSON.stringify(r.dissent)} accepts=${r.accepts}${r.needed ? ` needed=${r.needed}` : ''}${r.converged !== undefined ? ` converged=${r.converged} rounds=${r.rounds}` : ''}${r.threshold !== undefined ? ` threshold=${r.threshold}` : ''}`);
}
verdict('P1', rByz.decision === 'deploy-v2' && JSON.stringify(rByz.dissent) === '["node-e"]'
  && rRaft.decision === 'deploy-v2' && JSON.stringify(rRaft.dissent) === '["node-e"]'
  && rGossip.decision === 'deploy-v2' && rGossip.converged === true
  && JSON.stringify(rCrdt.decision) === '["deploy-v2"]' && rCrdt.dissent.length === 0
  && rQuorum.decision === 'deploy-v2' && JSON.stringify(rQuorum.dissent) === '["node-e"]',
  'all five rules decide deploy-v2; dissent = the reject voter (crdt dissent structurally empty)');

console.log('\n═══════════════════════════════════════════════════');
console.log('P2 — byzantine with 1 faulty member -> decision correct');
console.log('═══════════════════════════════════════════════════');
const r2 = consensus.propose('byzantine', { value: 'deploy-v2', members: MEMBERS, votes: VOTES, f: 1 });
console.log(`byzantine n=5 f=1 accepts=${r2.accepts} needed=${r2.needed} -> decision=${JSON.stringify(r2.decision)} dissent=${JSON.stringify(r2.dissent)}`);
verdict('P2', r2.decision === 'deploy-v2' && r2.f === 1 && r2.accepts === 4 && r2.needed === 3,
  'one faulty reject tolerated: 4 accepts clear the max(majority, 2f+1) quorum');

console.log('\n═══════════════════════════════════════════════════');
console.log('P3 — byzantine with f too large -> E_BYZANTINE_IMPOSSIBLE');
console.log('═══════════════════════════════════════════════════');
const r3 = expectError(() => consensus.propose('byzantine', { value: 'x', members: MEMBERS, f: 2 }), 'E_BYZANTINE_IMPOSSIBLE');
console.log(`byzantine n=5 f=2 -> ${r3.threw ? r3.err.message : 'NO ERROR (bad)'}`);
verdict('P3', r3.threw, 'f=2 with n=5 violates n >= 3f+1 (needs 7) -> E_BYZANTINE_IMPOSSIBLE');

console.log('\n═══════════════════════════════════════════════════');
console.log('P4 — quorum threshold > members -> E_IMPOSSIBLE_QUORUM');
console.log('═══════════════════════════════════════════════════');
const r4 = expectError(() => consensus.propose('quorum', { value: 'x', members: MEMBERS, threshold: 6 }), 'E_IMPOSSIBLE_QUORUM');
console.log(`quorum threshold=6 of 5 members -> ${r4.threw ? r4.err.message : 'NO ERROR (bad)'}`);
const r4b = consensus.propose('quorum', { value: 'x', members: MEMBERS, threshold: 5, votes: { 'node-b': 'reject', 'node-c': 'reject' } });
console.log(`quorum threshold=5, 3 accepts -> decision=${JSON.stringify(r4b.decision)} dissent=${JSON.stringify(r4b.dissent)}`);
verdict('P4', r4.threw && r4b.decision === null && JSON.stringify(r4b.dissent) === '["node-b","node-c"]',
  'threshold 6 of 5 refused; threshold 5 with 3 accepts -> no decision, dissent recorded');

console.log('\n═══════════════════════════════════════════════════');
console.log('P5 — unknown algo -> E_UNKNOWN_ALGO');
console.log('═══════════════════════════════════════════════════');
const r5 = expectError(() => consensus.propose('proof-of-work', { value: 'x', members: MEMBERS }), 'E_UNKNOWN_ALGO');
console.log(`propose('proof-of-work', ...) -> ${r5.threw ? r5.err.message : 'NO ERROR (bad)'}`);
verdict('P5', r5.threw, 'E_UNKNOWN_ALGO raised for an unregistered algorithm');

console.log('\n═══════════════════════════════════════════════════');
console.log('P6 — determinism + validate() recomputation');
console.log('═══════════════════════════════════════════════════');
const mk = () => JSON.stringify(consensus.propose('byzantine', { value: 'deploy-v2', members: MEMBERS, votes: VOTES, f: 1 }));
const s1 = mk();
const s2 = mk();
console.log(`byzantine result bytes: run1=${s1.length} run2=${s2.length} identical=${s1 === s2}`);
const real = consensus.propose('raft', { value: 'deploy-v2', members: MEMBERS, votes: VOTES });
const vGood = consensus.validate('raft', real);
console.log(`validate(real raft result) -> ${JSON.stringify(vGood)}`);
const tampered = { ...real, decision: 'deploy-v9' };
const vBad = consensus.validate('raft', tampered);
console.log(`validate(tampered raft decision) -> ${JSON.stringify(vBad)}`);
verdict('P6', s1 === s2 && vGood.valid === true && vBad.valid === false,
  'byte-identical across runs; validate() accepts the genuine result and rejects a tampered one');

console.log(`\nSCOPE C: ${6 - failures}/6 PASS, ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
