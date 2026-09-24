/**
 * JEXI OS — Phase 15 Scope C — live probe for the council.
 * Run: node scripts/phase15-c-probe.mjs
 */
import fs from 'node:fs';
import { createCouncil } from '../services/omnia/council/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const DIR = '/tmp/p15-council';
fs.rmSync(DIR, { recursive: true, force: true });
const council = createCouncil(DIR);

// P1 — convene + unknown role
const cv = council.convene({
  topic: 'adopt graph store',
  roles: [{ by: 'a1', role: 'chair' }, { by: 'a2', role: 'skeptic' }, { by: 'a3', role: 'builder' }],
});
console.log('P1 ' + cv.councilId + ' participants=' + cv.participants.map((p) => p.by + ':' + p.role).join(', '));
ok(cv.councilId === 'council-001' && cv.participants.length === 3, 'P1 convene returns councilId + 3 participants');
const badRole = errOf(() => council.convene({ topic: 'x', roles: [{ by: 'z1', role: 'wizard' }] }));
ok(badRole && badRole.code === 'E_UNKNOWN_ROLE', 'P1 unknown role -> E_UNKNOWN_ROLE');

// P2 — votes + errors
const v1 = council.vote(cv.councilId, { by: 'a1', choice: 'adopt', rationale: 'graph store centralizes context' });
const v2 = council.vote(cv.councilId, { by: 'a2', choice: 'reject', rationale: 'migration cost is unproven' });
const v3 = council.vote(cv.councilId, { by: 'a3', choice: 'adopt', rationale: 'feasible behind an adapter' });
console.log('P2 recorded: ' + [v1, v2, v3].map((v) => v.by + '=' + v.choice).join(', '));
ok(v1.recorded && v2.recorded && v3.recorded, 'P2 three votes recorded');
const cvTmp = council.convene({ topic: 'tmp', roles: [{ by: 't1', role: 'chair' }] });
const noRat = errOf(() => council.vote(cvTmp.councilId, { by: 't1', choice: 'adopt' }));
const unknownVoter = errOf(() => council.vote(cv.councilId, { by: 'a9', choice: 'adopt', rationale: 'r' }));
ok(noRat && noRat.code === 'E_MISSING_RATIONALE', 'P2 missing rationale -> E_MISSING_RATIONALE');
ok(unknownVoter && unknownVoter.code === 'E_UNKNOWN_VOTER', 'P2 non-participant -> E_UNKNOWN_VOTER');

// P3 — decide
const d = council.decide(cv.councilId);
console.log('P3 decision=' + JSON.stringify(d.decision));
console.log('P3 tally=' + JSON.stringify(d.tally));
console.log('P3 dissents=' + JSON.stringify(d.dissents));
ok(d.decision.choice === 'adopt' && d.tally.adopt === 2 && d.tally.reject === 1, 'P3 decide returns majority decision + tally');
ok(d.dissents.length === 1 && d.dissents[0].by === 'a2', 'P3 dissents capture the against-vote');

// P4 — already decided
const dbl = errOf(() => council.decide(cv.councilId));
ok(dbl && dbl.code === 'E_ALREADY_DECIDED', 'P4 second decide -> E_ALREADY_DECIDED');

// P5 — record into Phase 14 decisions log
const rec = council.record(cv.councilId);
console.log('P5 decisionId=' + rec.decisionId);
const p14 = council.log.get(rec.decisionId);
console.log('P5 phase-14 record: subject=' + p14.subject);
console.log('P5 phase-14 record: chosen=' + p14.chosen + ' alternatives=' + JSON.stringify(p14.alternatives) + ' by=' + p14.by);
ok(rec.decisionId === 'decision-001' && p14 && p14.chosen === 'adopt' && p14.by === 'a1', 'P5 record landed in Phase 14 decisions log (read back via get)');

// P6 — no quorum
const cv2 = council.convene({
  topic: 'rename the vault',
  roles: [{ by: 'b1', role: 'chair' }, { by: 'b2', role: 'skeptic' }, { by: 'b3', role: 'builder' }],
});
council.vote(cv2.councilId, { by: 'b1', choice: 'rename', rationale: 'clarity' });
const noQ = errOf(() => council.decide(cv2.councilId));
console.log('P6 votes=1 quorum needed=2 -> ' + (noQ ? noQ.code : 'no error'));
ok(noQ && noQ.code === 'E_NO_QUORUM', 'P6 below quorum -> E_NO_QUORUM');

// P7 — determinism: same sequence on a fresh dir + fresh log
const DIR2 = '/tmp/p15-council2';
fs.rmSync(DIR2, { recursive: true, force: true });
const c2 = createCouncil(DIR2);
const r = c2.convene({ topic: 'adopt graph store', roles: [{ by: 'a1', role: 'chair' }, { by: 'a2', role: 'skeptic' }, { by: 'a3', role: 'builder' }] });
c2.vote(r.councilId, { by: 'a1', choice: 'adopt', rationale: 'graph store centralizes context' });
c2.vote(r.councilId, { by: 'a2', choice: 'reject', rationale: 'migration cost is unproven' });
c2.vote(r.councilId, { by: 'a3', choice: 'adopt', rationale: 'feasible behind an adapter' });
const d2 = c2.decide(r.councilId);
const rec2 = c2.record(r.councilId);
const snap1 = JSON.stringify(council.decide ? d : null) + JSON.stringify(council.log.get(rec.decisionId));
const snap2 = JSON.stringify(d2) + JSON.stringify(c2.log.get(rec2.decisionId));
ok(snap1 === snap2 && rec.decisionId === rec2.decisionId, 'P7 same sequence -> byte-identical outcome + record');

console.log('');
console.log('SCOPE C: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
