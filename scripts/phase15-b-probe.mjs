/**
 * JEXI OS — Phase 15 Scope B — live probe for the relay.
 * Run: node scripts/phase15-b-probe.mjs
 */
import fs from 'node:fs';
import { createRelay, claudeCode, codex } from '../services/omnia/relay/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };

const DIR = '/tmp/p15-relay';
fs.rmSync(DIR, { recursive: true, force: true });
const relay = createRelay(DIR);

// P1 — attach + write + read
const a1 = relay.attach(claudeCode);
const a2 = relay.attach(codex);
console.log('P1 attached: ' + a1.name + '=' + a1.registered + ', ' + a2.name + '=' + a2.registered);
const w1 = relay.write({ from: 'claude-code', task: 'finish the parser', state: { step: 3, files: ['a.js', 'b.js'], notes: 'stuck on lookahead' } });
const r1 = relay.read(w1.handoffId);
console.log('P1 ' + w1.handoffId + ' from=' + r1.from + ' task=' + r1.task + ' state.step=' + r1.state.step);
ok(a1.registered && a2.registered, 'P1 both adapters registered');
ok(r1.from === 'claude-code' && r1.task === 'finish the parser' && r1.state.step === 3 && r1.resumedBy === undefined, 'P1 read returns written state');

// P2 — resume + double resume
const res = relay.resume(w1.handoffId, 'codex');
const r1b = relay.read(w1.handoffId);
console.log('P2 resume: resumed=' + res.resumed + ' at=' + res.at + ' resumedBy=' + r1b.resumedBy);
ok(res.resumed === true && r1b.resumedBy === 'codex', 'P2 resume records resumedBy=codex');
let dbl = null;
try { relay.resume(w1.handoffId, 'codex'); } catch (e) { dbl = e; }
ok(dbl && dbl.code === 'E_ALREADY_RESUMED', 'P2 second resume -> E_ALREADY_RESUMED');

// P3 — unknown id
let unk = null;
try { relay.read('handoff-999'); } catch (e) { unk = e; }
ok(unk && unk.code === 'E_UNKNOWN_HANDOFF', 'P3 unknown handoffId -> E_UNKNOWN_HANDOFF');

// P4 — round-trip lossless: write -> read -> write(read state)
const w2 = relay.write({ from: r1.from, task: r1.task, state: r1.state });
const r2 = relay.read(w2.handoffId);
console.log('P4 ' + w1.handoffId + ' -> ' + w2.handoffId + ' states byte-identical: ' + (JSON.stringify(r1.state) === JSON.stringify(r2.state)));
ok(JSON.stringify(r1.state) === JSON.stringify(r2.state) && r1.from === r2.from && r1.task === r2.task, 'P4 write->read->write is lossless');

// P5 — war-room persistence
relay.join('parser-room', 'claude-code');
relay.join('parser-room', 'codex');
relay.post('parser-room', { by: 'claude-code', text: 'started the parser' });
relay.post('parser-room', { by: 'codex', text: 'reviewed lookahead logic' });
relay.post('parser-room', { by: 'codex', text: 'handed back' });
const room = relay.warRoom('parser-room');
console.log('P5 participants=' + room.participants.join(',') + ' messages=' + room.messages.length);
ok(room.participants.length === 2 && room.messages.length === 3 && room.messages.map((m) => m.seq).join() === '1,2,3', 'P5 room holds 3 ordered messages');
const reloaded = createRelay(DIR).warRoom('parser-room');
ok(JSON.stringify(reloaded.messages) === JSON.stringify(room.messages), 'P5 reload from disk returns same messages');

// P6 — determinism: same ops on a fresh relay dir
const DIR2 = '/tmp/p15-relay2';
fs.rmSync(DIR2, { recursive: true, force: true });
const relay2 = createRelay(DIR2);
relay2.attach(claudeCode);
relay2.attach(codex);
relay2.write({ from: 'claude-code', task: 'finish the parser', state: { step: 3, files: ['a.js', 'b.js'], notes: 'stuck on lookahead' } });
relay2.resume('handoff-001', 'codex');
relay2.join('parser-room', 'claude-code');
relay2.join('parser-room', 'codex');
relay2.post('parser-room', { by: 'claude-code', text: 'started the parser' });
relay2.post('parser-room', { by: 'codex', text: 'reviewed lookahead logic' });
relay2.post('parser-room', { by: 'codex', text: 'handed back' });
const snap1 = JSON.stringify(relay.read('handoff-001')) + '|' + JSON.stringify(relay.warRoom('parser-room'));
const snap2 = JSON.stringify(relay2.read('handoff-001')) + '|' + JSON.stringify(relay2.warRoom('parser-room'));
ok(snap1 === snap2, 'P6 same sequence -> byte-identical state');

console.log('');
console.log('SCOPE B: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
