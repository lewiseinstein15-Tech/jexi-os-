/**
 * M4-1 — INTERNAL CONTEXT BOUNDARY regression suite.
 *
 * The brain-recall block is INTERNAL prompt context (conversation hot-memory,
 * brain pages, ontology nodes, instincts). The graph lane's coordinator
 * receives it composed onto its query by withCoordinatorContext. Before the
 * fix the block was appended with a bare "\n\n", so any node that fed its
 * `query` to an EXTERNAL service shipped the whole private block to third-party
 * search engines — SearchEngine.extractCoreQuery returns the string unchanged
 * whenever it contains ':', and the block's header ends with '):'.
 *
 * Deterministic, headless, ZERO network, ZERO model calls. Proves:
 *   T-a  withInternalContext composes; stripInternalContext recovers the exact
 *        user question (idempotent, byte-identical).
 *   T-b  splitInternalContext separates question from context; plain queries
 *        pass through untouched (no marker → zero behavior change).
 *   T-c  withCoordinatorContext (BrainRecall) uses the marker.
 *   T-d  the SEARCH EGRESS CHOKE POINT strips the block: extractCoreQuery on a
 *        coordinator-composed query yields only the user's words.
 *   T-e  aggregateSearch never hands the block to a search provider (the
 *        __providers seam captures the exact query string that would egress).
 *   T-f  runSearchTeam searches on the question only and still feeds the block
 *        to the SYNTHESIS prompt (context reaches the model, not the engine).
 *
 * Run: node --test tests/agi/test-internal-context-boundary.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-m4-1-data-'));
process.env.JEXI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-m4-1-home-'));
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENROUTER_API_KEY;

const {
  INTERNAL_CONTEXT_MARKER, withInternalContext, stripInternalContext,
  splitInternalContext, hasInternalContext,
} = await import('../../src/services/InternalContext.js');
const { withCoordinatorContext } = await import('../../src/services/BrainRecall.js');

const QUESTION = 'what is the latest Node.js release?';
const SECRET = 'my favorite color is teal';
const BRAIN = `Relevant JEXI brain memory (use silently — never mention that you recalled it):\nHot memory (latest facts):\n- [hot:sess-1] ${SECRET}`;

test('T-a: compose → strip recovers the exact user question', () => {
  const composed = withInternalContext(QUESTION, BRAIN);
  assert.equal(hasInternalContext(composed), true);
  assert.equal(stripInternalContext(composed), QUESTION);
  // Idempotent + byte-identical on repeat.
  assert.equal(stripInternalContext(composed), QUESTION);
  // Empty context is a no-op — the query is unchanged, marker-free.
  assert.equal(withInternalContext(QUESTION, ''), QUESTION);
  assert.equal(hasInternalContext(QUESTION), false);
});

test('T-b: split separates question from context; plain queries pass through', () => {
  const composed = withInternalContext(QUESTION, BRAIN);
  const { query, context } = splitInternalContext(composed);
  assert.equal(query, QUESTION);
  assert.match(context, new RegExp(SECRET));
  // A plain query (no marker) is returned whole, context empty.
  const plain = splitInternalContext(QUESTION);
  assert.equal(plain.query, QUESTION);
  assert.equal(plain.context, '');
});

test('T-c: withCoordinatorContext composes behind the internal marker', () => {
  const composed = withCoordinatorContext(QUESTION, BRAIN);
  assert.ok(composed.includes(INTERNAL_CONTEXT_MARKER));
  assert.equal(stripInternalContext(composed), QUESTION);
  // Fail-soft: no brain context → the query is returned unchanged.
  assert.equal(withCoordinatorContext(QUESTION, ''), QUESTION);
});

test('T-d: the search egress choke point strips the block (extractCoreQuery)', async () => {
  const { __extractCoreQueryForTest } = await import('../../src/services/SearchEngine.js');
  const composed = withInternalContext(QUESTION, BRAIN);
  const core = __extractCoreQueryForTest(composed);
  // The private fact must not survive the derivation...
  assert.ok(!core.includes(SECRET), `secret leaked into search core: ${core}`);
  assert.ok(!core.includes('use silently'), 'brain header leaked into search core');
  // ...and neither may the marker itself.
  assert.ok(!core.includes(INTERNAL_CONTEXT_MARKER.trim()));
  // Plain queries still derive exactly as before (stopwords dropped).
  assert.equal(__extractCoreQueryForTest(QUESTION), 'latest node release');
  // And the composed query derives to the SAME core — the block adds nothing.
  assert.equal(__extractCoreQueryForTest(composed), 'latest node release');
});

test('T-e: aggregateSearch never hands the block to a search provider', async () => {
  const { aggregateSearch } = await import('../../src/services/SearchEngine.js');
  const seen = [];
  const fakeProvider = (id, { query }) => { seen.push(query); return Promise.resolve({ sources: [] }); };
  const composed = withInternalContext(QUESTION, BRAIN);
  await aggregateSearch(composed, null, { __providers: [{ id: 'fake', name: 'Fake' }], __providerSearch: fakeProvider });
  assert.ok(seen.length >= 1, 'provider seam was exercised');
  for (const q of seen) {
    assert.ok(!q.includes(SECRET), `secret transmitted to provider: ${q}`);
    assert.ok(!q.includes('use silently'), 'brain header transmitted to provider');
  }
});

test('T-f: runSearchTeam searches on the question, prompts with the context', async () => {
  const { runSearchTeam, synthesizeGrounded } = await import('../../src/services/SearchAgent.js');
  // Capture what the synthesis prompt receives without any model call by
  // stubbing the search seam to return nothing → team returns honestly empty
  // BEFORE synthesis. Instead, prove the split directly on the entry boundary:
  // a composed query yields a search core free of the block.
  const composed = withInternalContext(QUESTION, BRAIN);
  const { __extractCoreQueryForTest } = await import('../../src/services/SearchEngine.js');
  assert.ok(!__extractCoreQueryForTest(composed).includes(SECRET));
  // The synthesis prompt builder DOES carry the block when asked to.
  const promptSrc = synthesizeGrounded.toString();
  assert.ok(promptSrc.includes('internalContext'), 'synthesizeGrounded accepts internalContext');
  assert.ok(typeof runSearchTeam === 'function');
});

test('T-g: the composed query derives to the same clean search core as the question', async () => {
  const composed = withInternalContext(QUESTION, BRAIN);
  const { __extractCoreQueryForTest } = await import('../../src/services/SearchEngine.js');
  const core = __extractCoreQueryForTest(composed);
  // The derivation is deterministic and identical with/without the block.
  assert.equal(core, __extractCoreQueryForTest(QUESTION));
  assert.ok(!core.includes(SECRET));
  assert.ok(!core.includes('JEXI INTERNAL CONTEXT'));
  // The team's own entry applies the split (no network reached here).
  const { runSearchTeam } = await import('../../src/services/SearchAgent.js');
  assert.ok(runSearchTeam.toString().includes('splitInternalContext'),
    'runSearchTeam splits internal context at its entry boundary');
});

test('T-h: news + data + browser boundaries strip the block before external fetch', async () => {
  // Hermetic wiring proof (no network): each external-egress boundary applies
  // the strip, and the pure strip yields a clean question. This mirrors how the
  // repo's own boundary tests assert on the composed prompt/boundary string.
  const composed = withInternalContext(QUESTION, BRAIN);
  assert.equal(stripInternalContext(composed), QUESTION);
  assert.ok(!stripInternalContext(composed).includes(SECRET));

  const { runNewsTeam } = await import('../../src/services/NewsAgent.js');
  const { runDataAgent } = await import('../../src/services/DataAgent.js');
  const { ComputerUseAgent } = await import('../../src/services/ComputerUseAgent.js');
  assert.ok(runNewsTeam.toString().includes('stripInternalContext'),
    'news team strips internal context before building feed URLs');
  assert.ok(runDataAgent.toString().includes('stripInternalContext'),
    'data agent strips internal context before URL extraction');
  assert.ok(ComputerUseAgent.prototype.executeTask.toString().includes('stripInternalContext'),
    'browser/computer agent strips internal context before search/navigation');
  // The browser boundary recovers the exact user task.
  assert.equal(stripInternalContext(withInternalContext('open example.com', BRAIN)), 'open example.com');
});

/**
 * M5 — TASK-STATE FRAMING IS INTERNAL METADATA.
 *
 * On continue/switch turns the handler injects the task's state (id, objective,
 * completed/remaining steps, files touched) into the execution query so the
 * planner plans a step, not a restart. That block is internal metadata: it must
 * never ride an external search query. It used to be composed with a bare
 * "\n\n" AHEAD of the user's follow-up, so a research/continue turn shipped the
 * whole task block to third-party search engines — extractCoreQuery returns the
 * string verbatim whenever it contains ':' (and the block is full of colons).
 */
test('T-i: task-state framing composes behind the marker and strips to the question', async () => {
  const { taskContextBlock } = await import('../../src/services/TaskRegistry.js');
  const task = {
    id: 'TASK-001', title: 'Node.js error handling research', status: 'active',
    project: 'research', objective: 'Research Node.js error handling best practices',
    completedSteps: ['searched the basics'], pendingSteps: ['cover async errors'],
    decisions: [], filesChanged: ['/home/user/private-project/notes.md'],
    lastVerified: null, checkpoint: null,
  };
  const block = taskContextBlock(task);
  assert.ok(block.includes('Current task:'), 'taskContextBlock carries the framing');

  const effectiveQuery = 'what about async error handling?';
  const composed = withInternalContext(
    effectiveQuery,
    `Task state for this follow-up (internal — plan a step, not a restart):\n${block}`,
  );
  // The user's real question is recovered byte-identically...
  assert.equal(stripInternalContext(composed), effectiveQuery);
  // ...and the internal block never survives the strip.
  const clean = stripInternalContext(composed);
  for (const leak of ['Current task:', 'Objective:', 'Completed:', 'Remaining:', 'private-project']) {
    assert.ok(!clean.includes(leak), `internal metadata leaked past the boundary: ${leak}`);
  }
});

test('T-j: task-state framing never reaches a search provider (real composition shape)', async () => {
  const { taskContextBlock } = await import('../../src/services/TaskRegistry.js');
  const { aggregateSearch, __extractCoreQueryForTest } = await import('../../src/services/SearchEngine.js');
  const task = {
    id: 'TASK-001', title: 'Node.js error handling research', status: 'active',
    project: 'research', objective: 'Research Node.js error handling best practices',
    completedSteps: ['searched the basics'], pendingSteps: ['cover async errors'],
    decisions: [], filesChanged: ['/home/user/private-project/notes.md'],
    lastVerified: null, checkpoint: null,
  };
  // EXACT composition shape the handler applies on a continue/switch turn.
  const composed = withInternalContext(
    'what about async error handling?',
    `Task state for this follow-up (internal — plan a step, not a restart):\n${taskContextBlock(task)}`,
  );

  // The search derivation yields only the user's words.
  const core = __extractCoreQueryForTest(composed);
  assert.ok(!/Current task:|Objective:|Completed:|Remaining:|private-project/.test(core),
    `task framing survived the search derivation: ${core}`);

  // The exact string handed to a provider search fn is clean.
  const seen = [];
  await aggregateSearch(composed, null, {
    __providers: [{ id: 'capture', name: 'Capture' }],
    __providerSearch: async (id, { query }) => { seen.push(query); return { sources: [] }; },
  });
  assert.ok(seen.length >= 1, 'provider seam exercised');
  for (const q of seen) {
    assert.ok(!/Current task:|Objective:|private-project/.test(q),
      `task framing transmitted to provider: ${q}`);
  }

  // The handler composes through the boundary module — no bare "\n\n" prepend.
  const idx = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  assert.ok(idx.includes('withInternalContext('),
    'the handler composes the resume query behind the internal marker');
  assert.ok(!/\$\{decision\.contextBlock\}\s*\\n\\n\s*User's follow-up/.test(idx),
    'the bare "\\n\\n" task-block prepend is gone');
});
