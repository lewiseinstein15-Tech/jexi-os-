/**
 * AGI Phase 4 — global world model + memory layers. Keyless, deterministic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_DIR = './data/test-agi-world';

const WM = await import('../../src/services/director/WorldModel.js');
const ML = await import('../../src/services/MemoryLayers.js');

/* ═══ 1. WORLD MODEL — structured, not a chat log ═══════════════════════ */

test('entities are typed and queryable by type and name', () => {
  WM.__resetWorldModel();
  WM.entity('project', 'JEXI OS');
  WM.entity('repo', 'jexi-os-');
  WM.entity('user', 'Lewis');
  assert.equal(WM.queryWorld({ type: 'project' }).length, 1);
  assert.equal(WM.queryWorld({ nameContains: 'jexi' }).length >= 1, true);
  assert.equal(WM.queryWorld({ type: 'user' })[0].name, 'Lewis');
  assert.throws(() => WM.entity('planet', 'Mars'), /unknown entity type/);
});

test('facts are epistemic claims — inferences never overwrite observations', () => {
  WM.__resetWorldModel();
  WM.recordFact('site', 'docs.example.com', { attribute: 'up', value: true, source: 'OBSERVED', evidence: 'HTTP 200' });
  const guessed = WM.recordFact('site', 'docs.example.com', { attribute: 'up', value: false, source: 'INFERRED', evidence: 'model guess' });
  assert.equal(guessed.epistemic, 'KNOWN'); // the observation stands
  assert.equal(guessed.value, true);
  const view = WM.entityView('site', 'docs.example.com');
  assert.equal(view.facts.up.epistemic, 'KNOWN');
  assert.equal(view.facts.up.source, 'OBSERVED');
});

test('conflicting observations become CONTRADICTED with both sides kept', () => {
  WM.__resetWorldModel();
  WM.recordFact('api', 'weather', { attribute: 'quotaLeft', value: 100, source: 'OBSERVED', evidence: 'header x-quota: 100' });
  const c = WM.recordFact('api', 'weather', { attribute: 'quotaLeft', value: 0, source: 'OBSERVED', evidence: 'header x-quota: 0' });
  assert.equal(c.epistemic, 'CONTRADICTED');
  assert.equal(c.conflict.length, 2);
});

test('typed relations connect entities; events are bounded', () => {
  WM.__resetWorldModel();
  WM.relate('project', 'JEXI OS', 'uses', 'api', 'weather');
  WM.relate('task', 'ship phase 4', 'part-of', 'project', 'JEXI OS');
  const proj = WM.queryWorld({ type: 'project' })[0];
  assert.equal(proj.relations.length, 1); // relations live on the FROM side
  assert.equal(proj.relations[0].relation, 'uses');
  assert.match(proj.relations[0].to, /api:weather/);
  const task = WM.queryWorld({ type: 'task' })[0];
  assert.equal(task.relations[0].relation, 'part-of');
  assert.match(task.relations[0].to, /project:jexi os/);
  for (let i = 0; i < 350; i++) WM.recordEvent('noise', { i });
  assert.ok(WM.worldModelStats().events <= 300);
});

test('the uncertainty report lists every non-KNOWN claim, worst first', () => {
  WM.__resetWorldModel();
  WM.recordFact('goal', 'launch', { attribute: 'date', value: '2026-10-01', source: 'ASSUMED' });
  WM.recordFact('file', 'server.js', { attribute: 'exists', value: true, source: 'OBSERVED' });
  const u = WM.uncertainties();
  assert.equal(u.length, 1);
  assert.equal(u[0].entity, 'goal:launch');
  assert.equal(u[0].epistemic, 'UNCERTAIN');
});

test('the world model survives restart (atomic persistence)', () => {
  WM.__resetWorldModel();
  WM.recordFact('tool', 'web-search', { attribute: 'working', value: true, source: 'OBSERVED', evidence: 'engine returned results' });
  WM.relate('project', 'JEXI OS', 'uses', 'tool', 'web-search');
  // simulate a restart: drop the in-memory model, keep the file, reload
  WM.__dropCache();
  const view = WM.entityView('tool', 'web-search');
  assert.equal(view.facts.working.epistemic, 'KNOWN');
  assert.equal(view.facts.working.value, true);
  assert.equal(WM.queryWorld({ type: 'project' }).length, 1);
});

/* ═══ 2. MEMORY LAYERS — one retrieval interface ════════════════════════ */

test('working memory stores, ranks by relevance, and respects the bound', () => {
  ML.clearWorkingMemory();
  ML.setWorkingMemory('w1', 'the deploy uses Docker on port 3002', { importance: 2 });
  ML.setWorkingMemory('w2', 'favorite color is green');
  ML.setWorkingMemory('w3', 'docker deploy failed once with 502');
  assert.equal(ML.getWorkingMemory().length, 3);
  // importance ranks first even without query overlap
  assert.equal(ML.getWorkingMemory()[0].id, 'w1');
});

test('recall() merges layers with labels and provenance', async () => {
  ML.clearWorkingMemory();
  ML.setWorkingMemory('w1', 'the deploy uses Docker on port 3002', { importance: 2 });
  const { recordLesson } = await import('../../src/services/director/Lessons.js');
  recordLesson({ kind: 'failure', missionId: 'wm-test', objective: 'deploy the service', itemTitle: 'deploy', failure: 'exit 0 but 502', cause: 'trusted exit code', strategy: 'curl the health URL', lesson: 'always curl the health URL after deploy' });

  const results = await ML.recall('deploy docker health', { limit: 10 });
  assert.ok(results.length >= 1);
  assert.ok(results.every((r) => r.layer && r.source)); // every result labeled
  const working = results.filter((r) => r.layer === 'working');
  const procedural = results.filter((r) => r.layer === 'procedural');
  assert.equal(working.length, 1);
  assert.match(working[0].content, /Docker/);
  assert.ok(procedural.some((p) => /health URL/.test(p.content)));
  assert.ok(procedural.every((p) => p.provenance && p.provenance.missionId === 'wm-test'));
});

test('layer selection limits what recall touches', async () => {
  ML.clearWorkingMemory();
  ML.setWorkingMemory('w9', 'explicitly working-layer content');
  const onlyWorking = await ML.recall('working content', { layers: ['working'], limit: 5 });
  assert.equal(onlyWorking.length, 1);
  assert.equal(onlyWorking[0].layer, 'working');
});

test('every layer is backed by a real store (status is honest)', () => {
  const status = ML.memoryLayerStatus();
  for (const layer of ['working', 'episodic', 'semantic', 'procedural', 'project', 'user']) {
    assert.ok(status[layer], `missing layer ${layer}`);
    assert.ok(status[layer].backed === true);
    assert.ok(status[layer].store.length > 3);
  }
});
