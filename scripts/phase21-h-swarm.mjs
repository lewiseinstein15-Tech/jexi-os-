// PHASE 21 — SCOPE H — LIVE PROBE: distributed research swarm (3 simulated agents).
// Zone-compliant: no file writes at all.
import assert from 'node:assert';
import { createResearchSwarm } from '../research/swarm/research-swarm.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AGENTS = ['agent-alpha', 'agent-beta', 'agent-gamma'];
const swarm = createResearchSwarm({ agents: AGENTS.map((id) => ({ id })), initialBest: 1.0222 });
const show = (label, obj) => console.log(`[${label}] ${JSON.stringify(obj)}`);

try {
  console.log(`[start] frontier=${JSON.stringify(swarm.frontier.snapshot())}`);

  // ---- agent-alpha proposes a real improvement; its run is GATED so beta can
  // propose the same experiment while the claim is still live ----
  const alphaExp = { agentId: 'agent-alpha', experimentId: 'alpha-true-slope', knobs: { lr: '3e-3' }, code: 'predict = 0.7x + 0.2' };
  let releaseAlpha;
  const alphaGate = new Promise((r) => {
    releaseAlpha = r;
  });
  const alphaPromise = swarm.propose({
    ...alphaExp,
    run: async () => {
      await alphaGate;
      return { kept: true, metric: 1.0001 };
    },
  });
  await sleep(10); // alpha's claim is now in-flight

  // ---- agent-beta proposes the SAME experiment while alpha's claim is live -> DEDUP ----
  const r2 = await swarm.propose({
    agentId: 'agent-beta',
    experimentId: 'beta-same-idea',
    knobs: { lr: '3e-3' },
    code: 'predict = 0.7x + 0.2',
    run: async () => ({ kept: true, metric: 1.0001 }),
  });
  show('agent-beta proposes duplicate (in-flight)', r2);
  assert.equal(r2.admitted, false, 'in-flight duplicate must be blocked');
  assert.equal(r2.duplicateOf, 'alpha-true-slope');
  assert.match(r2.reason, /in-flight on agent 'agent-alpha'/);

  // ---- release alpha's run -> kept, frontier advances ----
  releaseAlpha();
  const r1 = await alphaPromise;
  show('agent-alpha completes alpha-true-slope', r1);
  assert.equal(r1.verdict, 'kept');
  assert.equal(r1.frontier.advanced, true);

  // ---- agent-gamma proposes the same thing AFTER completion -> DEDUP (completed) ----
  const r3 = await swarm.propose({
    agentId: 'agent-gamma',
    experimentId: 'gamma-rehash',
    knobs: { lr: '3e-3' },
    code: 'predict = 0.7x + 0.2',
    run: async () => ({ kept: true, metric: 1.0001 }),
  });
  show('agent-gamma proposes duplicate (completed)', r3);
  assert.equal(r3.admitted, false);
  assert.match(r3.reason, /already completed as alpha-true-slope/);

  // ---- agent-beta runs an admitted-but-worse experiment ----
  const r4 = await swarm.propose({
    agentId: 'agent-beta',
    experimentId: 'beta-flatter',
    knobs: { lr: '1e-3' },
    code: 'predict = 0.5x + 0.4',
    run: async () => ({ kept: false, metric: 1.0199 }),
  });
  show('agent-beta proposes beta-flatter (worse)', r4);
  assert.equal(r4.admitted, true);
  assert.equal(r4.verdict, 'discarded');

  // ---- agent-gamma finds a real improvement -> shared frontier advances ----
  const r5 = await swarm.propose({
    agentId: 'agent-gamma',
    experimentId: 'gamma-warmup',
    knobs: { lr: '3e-3', warmup: '40' },
    code: 'predict = 0.7x + 0.2 // + lr warmup',
    run: async () => ({ kept: true, metric: 0.9998 }),
  });
  show('agent-gamma proposes gamma-warmup (better)', r5);
  assert.equal(r5.frontier.advanced, true, 'gamma must advance the shared frontier');
  assert.equal(swarm.frontier.best, 0.9998);
  assert.equal(swarm.frontier.bestBy, 'gamma-warmup');

  // ---- agent-alpha's next run crashes: its claim must be released ----
  const r6 = await swarm.propose({
    agentId: 'agent-alpha',
    experimentId: 'alpha-crashy',
    knobs: { lr: '9e-3' },
    code: 'predict = 0.7x + 0.2 // aggressive lr',
    run: async () => {
      throw new Error('candidate exploded');
    },
  });
  show('agent-alpha proposes alpha-crashy (crashes)', r6);
  assert.equal(r6.verdict, 'crashed');
  assert.equal(swarm.dedup.inflightCount(), 0, 'crashed experiment must release its claim');

  // ---- swarm-wide view ----
  console.log('\n--- shared frontier history ---');
  for (const h of swarm.frontier.history) {
    console.log(
      `  ${h.experimentId.padEnd(18)} metric=${h.metric ?? 'n/a'} advanced=${h.advanced} best=${h.best ?? 'n/a'}`,
    );
  }
  console.log('\n--- per-agent stats ---');
  for (const a of swarm.agentStats()) console.log(`  ${JSON.stringify(a)}`);
  console.log('\n--- swarm summary ---');
  const summary = swarm.summary();
  console.log(JSON.stringify(summary, null, 2));

  assert.equal(summary.proposed, 6);
  assert.equal(summary.admitted, 4);
  assert.equal(summary.kept, 2);
  assert.equal(summary.duplicatesBlocked, 2);
  assert.equal(summary.frontier.best, 0.9998);
  // frontier history records only actual runs: kept, discarded, kept (duplicates
  // never reach the frontier; the crashed run releases before offering).
  assert.equal(summary.frontier.updates, 3);

  console.log('\nSCOPE H PROBE PASSED');
} catch (err) {
  console.error('PROBE FAILURE:', err?.message ?? err);
  process.exit(1);
}
