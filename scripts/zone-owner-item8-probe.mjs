#!/usr/bin/env node
/**
 * ZONE-OWNER ITEM 8 LIVE PROBE — test-b211.js lease-TTL race, margins widened.
 * Run from repo root:  node scripts/zone-owner-item8-probe.mjs
 * Proves:
 *   1. the OLD margin (TTL 5ms) really loses the race under load: a ~10ms
 *      stall (GC pause / busy CI) between claim and assert expires the lease
 *      and the "still leased" assert would fail — flake reproduced
 *   2. the NEW margin (TTL 250ms) survives the same stall (and a 5× worse one)
 *   3. expiry semantics unchanged: after sleep(350) the lease IS reclaimable
 */
import { WorkGraph } from '../server/src/services/director/WorkGraph.js';

let fails = 0; let checks = 0;
const check = (label, cond, detail = '') => {
  checks++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const burn = (ms) => { const t = Date.now(); while (Date.now() - t < ms) { /* simulated GC/CPU stall */ } };

const makeGraph = () => {
  const g = new WorkGraph('ms-probe8');
  const c = g.addItem({ title: 'Urgent side task', planIndex: 1, capability: 'reasoning', priority: 'high' });
  return { g, c };
};

// ---- 1. OLD margin (5ms TTL) — flake reproduced under a 10ms stall
{
  const { g, c } = makeGraph();
  g.claim(c.id, 'worker-1', 5);      // the OLD test's TTL
  burn(10);                          // a stall the OLD test could not absorb
  const stillLeased = !g.readyWork().some((i) => i.id === c.id);
  check('OLD margin (TTL 5ms) loses the race under a 10ms stall — flake is REAL',
    stillLeased === false,
    `stillLeased=${stillLeased} (lease expired mid-assert window → old assert would fail)`);
}

// ---- 2. NEW margin (250ms TTL) — same stall, and 5× worse
{
  const { g, c } = makeGraph();
  g.claim(c.id, 'worker-1', 250);    // the NEW test's TTL
  burn(10);
  const stillLeased10 = !g.readyWork().some((i) => i.id === c.id);
  check('NEW margin (TTL 250ms) survives the same 10ms stall — assert window is 25× the old',
    stillLeased10 === true, `stillLeased=${stillLeased10}`);

  const { g: g2, c: c2 } = makeGraph();
  g2.claim(c2.id, 'worker-1', 250);
  burn(50);                          // 5× worse stall
  const stillLeased50 = !g2.readyWork().some((i) => i.id === c2.id);
  check('NEW margin survives a 50ms stall (5× the reproduced flake condition)',
    stillLeased50 === true, `stillLeased=${stillLeased50}`);
}

// ---- 3. expiry semantics unchanged with the new numbers
{
  const { g, c } = makeGraph();
  g.claim(c.id, 'worker-1', 250);
  check('fresh lease: item out of ready', !g.readyWork().some((i) => i.id === c.id));
  await sleep(350);                  // the NEW test's sleep — 100ms past the deadline
  check('after sleep(350): expired lease IS reclaimable (semantics unchanged)',
    g.readyWork().some((i) => i.id === c.id));
  const reclaimed = g.claim(c.id, 'worker-2', 60000);
  check('a different worker can claim the expired lease', Boolean(reclaimed));
}

console.log(`\n===== PROBE TALLY: ${checks} checked, ${checks - fails} pass, ${fails} fail =====`);
process.exit(fails === 0 ? 0 : 1);
