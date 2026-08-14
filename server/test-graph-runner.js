// B50 P6 — GRAPHRUNNER: typed nodes, outcomes (success/retry/fallback),
// conditioned edges, parallel fan-out + join, and a concrete high-stakes
// gate with a recovery path.
import { createGraph, when, runParallel } from './src/services/GraphRunner.js';

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}`);
};

// 1. Node types are surfaced (agent / tool / verifier / gate).
{
  const g = createGraph({
    start: 'a',
    nodes: {
      a: { type: 'agent', run: (s) => s },
      b: { type: 'tool', run: (s) => s },
      c: { type: 'verifier', run: (s) => s },
      d: { type: 'gate', run: (s) => s },
    },
    edges: { a: () => 'b', b: () => 'c', c: () => 'd', d: () => 'end' },
  });
  const final = await g.run({});
  check('typed nodes recorded (agent/tool/verifier/gate)', final.nodeTypes.a === 'agent' && final.nodeTypes.b === 'tool' && final.nodeTypes.c === 'verifier' && final.nodeTypes.d === 'gate');
  check('graph runs through all typed nodes', final.status === 'done' && final.history.join(',') === 'a,b,c,d');
}

// 2. Outcome 'retry' auto-reruns the SAME node, bounded by retries.
{
  let runs = 0;
  const g = createGraph({
    start: 'flaky',
    nodes: {
      flaky: { type: 'agent', retries: 3, run: (s) => { runs++; s.outcome = runs < 3 ? 'retry' : 'success'; return s; } },
    },
    edges: { flaky: when({ success: 'end' }) },
  });
  const final = await g.run({});
  check('retry outcome re-runs the node (3 runs)', runs === 3);
  check('retry exhausts into the edge (done)', final.status === 'done');
}

// 3. Concrete failure path: a gate fails → fallback → RECOVERY node → gate
//    re-enters → passes → done. (The high-stakes gate example.)
{
  let gateRuns = 0;
  let recoverRuns = 0;
  const g = createGraph({
    start: 'qa-gate',
    nodes: {
      'qa-gate': {
        type: 'gate',
        run: (s) => { gateRuns++; if (gateRuns < 3) { s.outcome = 'fallback'; s.context.lastQaVerdict = 'NEEDS FIX'; } else { s.outcome = 'success'; s.context.lastQaVerdict = 'PASS'; } return s; },
        fallback: 'recover-fix',
      },
      'recover-fix': { type: 'agent', run: (s) => { recoverRuns++; s.outcome = 'success'; return s; } },
    },
    edges: {
      'recover-fix': when({ success: 'qa-gate' }), // loop back through the gate
      'qa-gate': when({ success: 'end', fallback: 'recover-fix' }),
    },
  });
  const final = await g.run({});
  check('gate failed twice then passed (3 gate runs)', gateRuns === 3);
  check('failure path routed to the recovery node (2 recoveries)', recoverRuns === 2);
  check('recovery path is visible in history', final.history.join('>') === 'qa-gate>recover-fix>qa-gate>recover-fix>qa-gate');
  check('gate produced a success outcome at the end', final.outcome === 'success' && final.context.lastQaVerdict === 'PASS');
}

// 4. Parallel fan-out + join: three concurrent node fns write
//    intermediateResults[name]; the join sees all of them.
{
  const g = createGraph({
    start: 'fan',
    nodes: {
      fan: {
        type: 'agent',
        run: async (s) => {
          const results = await runParallel({
            state: s,
            fns: [
              { name: 'checker-a', run: async () => { await new Promise((r) => setTimeout(r, 20)); return { result: { ok: true, score: 92 } }; } },
              { name: 'checker-b', run: async () => { await new Promise((r) => setTimeout(r, 10)); return { result: { ok: false, score: 41 } }; } },
              { name: 'checker-c', run: async () => { await new Promise((r) => setTimeout(r, 5)); return { result: { ok: true, score: 88 } }; } },
            ],
            join: (merged) => { merged.outcome = 'success'; return merged; },
          });
          s = results;
          return s;
        },
      },
    },
    edges: { fan: when({ success: 'end' }) },
  });
  const final = await g.run({});
  check('parallel fan-out joined all 3 results', final.intermediateResults['checker-a']?.score === 92 && final.intermediateResults['checker-b']?.score === 41 && final.intermediateResults['checker-c']?.score === 88);
  check('parallel join preserves outcome', final.outcome === 'success');
}

// 5. A thrown node becomes a structured failure routed to fallback.
{
  const g = createGraph({
    start: 'boom',
    nodes: {
      boom: { type: 'tool', run: () => { throw new Error('engine exploded'); } },
      safe: { type: 'agent', run: (s) => { s.outcome = 'success'; return s; } },
    },
    edges: { boom: when({ fallback: 'safe' }), safe: when({ success: 'end' }) },
  });
  const final = await g.run({});
  check('thrown node is caught and routed', final.lastError?.code === 'NODE_THREW' && final.history.includes('safe'));
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
