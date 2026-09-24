/**
 * JEXI OS — Phase 7(F) — HUD STATUS CONTRACT tests.
 *
 * Covers: schema declaration, validator strictness (identity keys required,
 * version pin — P10), section omission tolerance (P7 debug path), producer
 * tool-call feed (recent grows, fail streak raises risk), spend notes
 * (sessionUsd grows, trend), checks notes, consumer refusal + fan-out, and
 * the end-to-end build() producing a fully-valid payload.
 *
 * Runs inside server/ so the dynamic subsystem imports resolve; every
 * subsystem call is fail-soft, so the build also works standalone.
 */
import assert from 'node:assert/strict';
import { HUD_VERSION, HUD_SCHEMA, TOP_LEVEL_KEYS, emptyPayload } from '../runtime/events/hud/schema.js';
import { validateHud, acceptHudOrThrow, isCompleteHud } from '../runtime/events/hud/validator.js';
import hud, {
  recordToolCall, noteToolPending, noteSpend, noteCheck, noteRisk,
  build, publish, snapshot, onPublish, consume, _resetProducer, _resetConsumer,
} from '../runtime/events/hud/index.js';

let passed = 0;
let failed = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { passed++; console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log('\n== HUD schema (jexi.hud-status.v1) ==');
ok(HUD_VERSION === 'jexi.hud-status.v1', 'version pin is jexi.hud-status.v1');
ok(TOP_LEVEL_KEYS.length === 15, 'contract declares 5 identity keys + 10 sections', TOP_LEVEL_KEYS.join(', '));
ok(HUD_SCHEMA.risk.fields.attention.values.join('|') === 'normal|warning|critical', 'risk.attention enum exact');

console.log('\n== HUD validator ==');
const full = emptyPayload();
full.sessionId = 'sess-test';
full.context = { model: 'openai/gpt-oss-120b', provider: 'groq', contextPressure: 0.42, tokensUsed: 840, tokensCap: 2000 };
full.toolCalls = { recent: [{ name: 'web.search', status: 'ok', durationMs: 210, at: new Date().toISOString() }], pending: 0, stale: 0, lastEvent: 'tool completed' };
full.activeAgents = [{ id: 'a1', name: 'Atlas', role: 'lead', state: 'working', objective: 'ship scope F', resourcePct: 12, startedAt: new Date().toISOString() }];
full.todos = [{ id: 'todo-0', text: 'wire console', status: 'active', owner: 'brain' }];
const v1 = validateHud(full);
ok(v1.valid === true, 'full payload validates', v1.errors.join('; ') || '0 errors');
ok(isCompleteHud(full) === true, 'isCompleteHud true on full payload');

const noVersion = { ...full };
delete noVersion.version;
const v2 = validateHud(noVersion);
ok(v2.valid === false && v2.errors.some((e) => e.startsWith('version:')), 'missing version → hard error (P10)', v2.errors[0]);
let refused = null;
try { acceptHudOrThrow(noVersion); } catch (e) { refused = e; }
ok(refused && refused.code === 'HUD_REFUSED', 'consumer refuses version-less payload (P10)');

const wrongVersion = { ...full, version: 'jexi.hud-status.v2' };
ok(validateHud(wrongVersion).valid === false, 'foreign version → hard error');

const badEnum = { ...full, risk: { ...full.risk, attention: 'panic' } };
const v3 = validateHud(badEnum);
ok(v3.valid === false && v3.errors.some((e) => e.includes('risk.attention')), 'bad enum value → error', v3.errors[0]);

const omitted = { ...full };
delete omitted.cost;
delete omitted.sync;
const v4 = validateHud(omitted);
ok(v4.valid === true, 'omitted sections stay schema-valid (P7 no-fabricate path)');

const unknown = { ...full, weather: 'sunny' };
const v5 = validateHud(unknown);
ok(v5.valid === true && v5.warnings.some((w) => w.startsWith('weather:')), 'unknown key → warning, not error');

console.log('\n== HUD producer feed ==');
_resetProducer(); _resetConsumer();
noteToolPending({ id: 'p1', name: 'fs.read' }, {});
ok(snapshot().payload === null, 'no payload before first publish (pending recorded silently)');
recordToolCall({ id: 'p1', name: 'fs.read' }, { ok: true, durationMs: 42 }, {});
const pub1 = await publish('test-1');
ok(pub1.changed === true && pub1.revision === 1, 'first publish bumps revision to 1');
ok(pub1.payload.toolCalls.recent.length === 1, 'toolCalls.recent grew to 1', JSON.stringify(pub1.payload.toolCalls.recent[0]));
ok(pub1.payload.toolCalls.recent[0].name === 'fs.read' && pub1.payload.toolCalls.recent[0].status === 'ok', 'recent[0] is the real call');
recordToolCall({ id: 'p2', name: 'fs.read' }, { ok: true, durationMs: 11 }, {});
recordToolCall({ id: 'p3', name: 'fs.read' }, { ok: true, durationMs: 9 }, {});
const pub2 = await publish('test-2');
ok(pub2.payload.toolCalls.recent.length === 3, 'toolCalls.recent grew to 3 (P3 shape)');

recordToolCall({ id: 'p4', name: 'net.post' }, { ok: false, durationMs: 5, error: 'boom' }, {});
recordToolCall({ id: 'p5', name: 'net.post' }, { ok: false, durationMs: 5, error: 'boom' }, {});
recordToolCall({ id: 'p6', name: 'net.post' }, { ok: false, durationMs: 5, error: 'boom' }, {});
const pub3 = await publish('test-3');
ok(pub3.payload.risk.attention === 'critical', '3 consecutive tool failures → risk critical', JSON.stringify(pub3.payload.risk));

noteSpend({ provider: 'groq', model: 'openai/gpt-oss-120b', inChars: 4000, outChars: 800, ok: true });
const pub4 = await publish('test-4');
ok(pub4.payload.cost.sessionUsd > 0, 'real spend note → sessionUsd > 0', `$${pub4.payload.cost.sessionUsd}`);
ok(pub4.payload.cost.trend === 'up', 'spend inside window → trend up');
const usdBefore = pub4.payload.cost.sessionUsd;
const freeSpend = noteSpend({ provider: 'pollinations', model: null, inChars: 100, outChars: 10, ok: true });
const pub5 = await publish('test-5');
ok(freeSpend === 0, 'free-tier provider prices at a real $0');
ok(pub5.payload.cost.sessionUsd >= usdBefore && pub5.payload.cost.sessionUsd > 0, 'ledger monotonic (never decreases)', `$${usdBefore} → $${pub5.payload.cost.sessionUsd}`);

noteCheck('local', 'running');
const pub6 = await publish('test-6');
ok(pub6.payload.checks.local === 'running', 'checks.local tracks verification.started');
noteCheck('local', 'fail');
const pub7 = await publish('test-7');
ok(pub7.payload.checks.local === 'fail' && pub7.payload.checks.lastRunAt, 'checks.local fail + lastRunAt stamped (P9 driver)');

noteRisk('shield.critical', 'critical');
const pub8 = await publish('test-8');
ok(pub8.payload.risk.attention === 'critical', 'critical signal → attention critical');

console.log('\n== HUD consumer ==');
const seen = [];
const unsub = onPublish((rev, payload) => seen.push({ rev, version: payload.version }));
await publish('fanout-test');
ok(seen.length >= 1 && seen[seen.length - 1].version === HUD_VERSION, 'consumer fan-out received the publish');
unsub();

const consumed = consume(pub8.payload);
ok(consumed.version === HUD_VERSION, 'consume() accepts a valid payload');
let refused2 = null;
try { consume({ ...pub8.payload, version: undefined }); } catch (e) { refused2 = e; }
ok(refused2 && refused2.code === 'HUD_REFUSED', 'consume() refuses without version (P10 consumer half)');

console.log('\n== HUD end-to-end build ==');
const payload = await build();
const vEnd = validateHud(payload);
ok(vEnd.valid === true, 'live build() payload validates against the contract', vEnd.errors.join('; ') || '0 errors');
ok(isCompleteHud(payload) === true, 'live build() carries ALL 10 sections + identity', Object.keys(payload).length + ' keys');
ok(['ask', 'plan', 'agent'].includes(payload.sessionControls.mode), 'sessionControls.mode is a real contract value', payload.sessionControls.mode);
ok(Array.isArray(payload.activeAgents) && payload.activeAgents.every((a) => ['idle', 'working', 'paused'].includes(a.state)), 'every agent state is honest (no invented states)', `${payload.activeAgents.length} agents`);

console.log('\n== HUD omit seam (P7 debug) ==');
process.env.JEXI_HUD_OMIT = 'cost';
const omittedLive = await build();
ok(omittedLive.cost === undefined && omittedLive.version === HUD_VERSION, 'JEXI_HUD_OMIT=cost removes ONLY that section');
ok(validateHud(omittedLive).valid === true, 'omitted payload still schema-valid (panels must show "no data")');
delete process.env.JEXI_HUD_OMIT;
const restored = await build();
ok(restored.cost !== undefined, 'omit cleared → section restored');

console.log(`\nHUD contract tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
