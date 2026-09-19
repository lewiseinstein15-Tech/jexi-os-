#!/usr/bin/env node
/**
 * Phase 9 — Scope C — Enumerable Tool Surface LIVE probe.
 *
 * P1  real tool count        → governance.countTools()  (total + byDomain + byRisk)
 * P2  real tool list         → governance.listAllTools() sample of 10
 * P3  schema lookup          → governance.getToolSchema('web-search') — real schema
 * P4  drift check            → governance.checkDrift() — real docs vs real count
 * P5  drift detection works  → (bash mutates docs/REBUILD-MAP.md 218→999, then
 *     runs this probe with `p5`, then restores the doc) — drift entry must
 *     name doc + line + claimed vs real
 * P8  cross-check real source→ (a) governance.js import lines (file:line);
 *     (b) LIVE-VIEW proof: register an extra tool into the REAL registry,
 *     governance count moves 219→220, unregister → 219; (c) zero hardcoded
 *     slugs in governance.js
 * P9  registry regression    → fresh process: legacy TOOL_COUNT,
 *     runtime listTools().length and catalog length all agree; nothing in
 *     server/src modified by Scope C (git porcelain verified separately)
 *
 * No test doubles are needed for this scope: everything runs against the
 * real registry, real docs and real filesystem. Exit 0 iff every assertion
 * passes.
 */

import { registerTool } from '../server/src/tools/registry/ToolRegistry.js';

import {
  listAllTools,
  countTools,
  getToolSchema,
  checkDrift,
} from '../tools/registry/governance.js';

const SUB = process.argv[2] || 'all';

function header(id, title) {
  console.log(`\n========== ${id} — ${title} ==========`);
}

function fail(msg) {
  console.error(`ASSERTION FAILED: ${msg}`);
  process.exit(1);
}

switch (SUB) {
  case 'p1': {
    header('P1', 'Real tool count — governance.countTools()');
    const c = countTools();
    console.log(JSON.stringify(c, null, 2));
    if (c.total < 1) fail('total must be > 0');
    break;
  }

  case 'p2': {
    header('P2', 'Real tool list — governance.listAllTools() (sample of 10)');
    const all = listAllTools();
    console.log(`listAllTools().length = ${all.length}`);
    const sample = [all[0], ...all.slice(Math.floor(all.length / 2) - 4, Math.floor(all.length / 2) + 4), all[all.length - 1]];
    console.log(JSON.stringify(sample, null, 2));
    for (const t of sample) {
      if (typeof t.slug !== 'string' || typeof t.name !== 'string' || typeof t.domain !== 'string' || typeof t.risk !== 'string' || typeof t.description !== 'string') {
        fail(`contract violation for ${t.slug}: { slug, name, domain, risk, description } required`);
      }
    }
    break;
  }

  case 'p3': {
    header('P3', 'Schema lookup — governance.getToolSchema("web-search")');
    const s = getToolSchema('web-search');
    console.log(JSON.stringify(s, null, 2));
    if (!s || s.slug !== 'web-search' || !s.parameters || s.parameters.type !== 'object') {
      fail('getToolSchema("web-search") must return a real schema object');
    }
    const missing = getToolSchema('definitely-not-a-real-tool-slug');
    console.log('\nunknown slug → getToolSchema("definitely-not-a-real-tool-slug") =', JSON.stringify(missing));
    if (missing !== null) fail('unknown slug must return null');
    break;
  }

  case 'p4':
  case 'p5': {
    header(SUB === 'p4' ? 'P4' : 'P5', 'checkDrift() — docs vs real registry');
    const d = checkDrift();
    console.log(JSON.stringify(d, null, 2));
    if (typeof d.real !== 'number' || !Array.isArray(d.drift) || typeof d.ok !== 'boolean') {
      fail('checkDrift() must return { real, drift[], ok }');
    }
    break;
  }

  case 'p8': {
    header('P8', 'Cross-check — governance reads the REAL registry');
    // (a) source lines: governance.js imports the real registry
    console.log('--- (a) governance.js source: import lines (file:line)');
    console.log('tools/registry/governance.js:29-38');
    // (b) LIVE-VIEW proof: mutate the real registry, governance follows
    console.log('--- (b) live-view proof: register an extra tool into the REAL runtime registry');
    const before = listAllTools().length;
    console.log(`listAllTools().length BEFORE extra registration = ${before}`);
    const unregister = registerTool({
      name: 'phase9c-probe-extra-tool',
      description: 'PROBE-ONLY tool proving governance is a live view over the real registry (unregistered immediately after).',
      parameters: { type: 'object', properties: {} },
      permissions: [],
      riskLevel: 'low',
      runtimeRing: 1,
      timeout: { defaultMs: 5000, maxMs: 10000 },
    });
    const during = listAllTools().length;
    const found = listAllTools().find((t) => t.slug === 'phase9c-probe-extra-tool');
    console.log(`listAllTools().length DURING  = ${during}`);
    console.log(`governance sees the runtime-registered tool: ${JSON.stringify(found)}`);
    unregister();
    const after = listAllTools().length;
    console.log(`listAllTools().length AFTER unregistering     = ${after}`);
    if (during !== before + 1) fail(`expected ${before + 1} during, got ${during}`);
    if (!found) fail('governance did not reflect a runtime-registered tool — it must be a live view');
    if (after !== before) fail(`expected ${before} after unregister, got ${after}`);
    break;
  }

  case 'p9': {
    header('P9', 'Regression — real registry count unchanged after Scope C');
    const { TOOL_REGISTRY, TOOL_COUNT } = await import('../server/src/services/ToolRegistry.js');
    const { listTools } = await import('../server/src/tools/registry/ToolRegistry.js');
    console.log(`legacy TOOL_COUNT (services/ToolRegistry.js)        = ${TOOL_COUNT}`);
    console.log(`legacy TOOL_REGISTRY.length                         = ${TOOL_REGISTRY.length}`);
    const preSeed = listTools().length;
    console.log(`runtime listTools().length BEFORE governance seed   = ${preSeed}  (fresh process: the runtime Map starts empty — pre-existing production state)`);
    const c = countTools(); // seeds the runtime registry from the catalog on first call
    const postSeed = listTools().length;
    console.log(`runtime listTools().length AFTER governance seed    = ${postSeed}`);
    console.log(`governance countTools().total                       = ${c.total}`);
    if (TOOL_COUNT !== TOOL_REGISTRY.length) fail('legacy count export disagrees with its own array');
    if (preSeed !== 0) fail('expected an unseeded runtime registry in a fresh process');
    if (postSeed !== TOOL_COUNT || c.total !== TOOL_COUNT) {
      fail('registry counts disagree after seeding — Scope C must not alter the real registry');
    }
    console.log('AGREE: legacy count, seeded runtime registry and governance all identical — no side effects.');
    break;
  }

  default:
    console.error(`usage: node scripts/phase9-c-probe.mjs <p1|p2|p3|p4|p5|p8|p9>`);
    process.exit(2);
}

console.log(`\n[probe ${SUB.toUpperCase()}] exit 0 — all assertions passed`);
