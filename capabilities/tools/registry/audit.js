#!/usr/bin/env node
/**
 * JEXI OS — tools/registry/audit.js (Phase 9 C — Enumerable Tool Surface)
 *
 * Standalone registry audit: executes governance.checkDrift() and reports
 * whether the docs' tool-count claims match the real registry.
 *
 * Library use:
 *   import { runAudit } from 'tools/registry/audit.js';
 *   const { ok, drift, real, claimed } = runAudit();
 *
 * CLI:
 *   node tools/registry/audit.js          # human-readable text report
 *   node tools/registry/audit.js --json   # machine-readable JSON report
 *
 * Exit codes: 0 = audit PASS (no drift), 1 = audit FAIL (drift detected).
 * The non-zero exit is deliberate so CI can gate on documentation drift.
 */

import { pathToFileURL } from 'node:url';

import { checkDrift, countTools, DOC_SOURCES } from './governance.js';

/**
 * Execute the audit. Shape required by the Phase 9 C contract:
 *   { ok, drift: [...], real: N, claimed: N }
 * plus the full claim list and run timestamp for traceability.
 */
export function runAudit() {
  const d = checkDrift();
  return {
    ok: d.ok,
    drift: d.drift,
    real: d.real,
    claimed: d.claimed,
    claims: d.claims,
    scanned: d.scanned,
    docs: [...DOC_SOURCES],
    at: new Date().toISOString(),
  };
}

/** Human-readable text report (used by the default CLI mode). */
function renderText(audit) {
  const lines = [];
  lines.push('JEXI OS — registry audit');
  lines.push('='.repeat(72));
  lines.push(`real tool count : ${audit.real}`);
  lines.push(`docs scanned    : ${audit.scanned}`);
  if (audit.claimed !== null) lines.push(`claimed count   : ${audit.claimed}`);
  lines.push('');
  lines.push('claims:');
  if (audit.claims.length === 0) {
    lines.push('  (no numeric tool-count claims found in scanned docs)');
  }
  for (const c of audit.claims) {
    if (c.claimed === null) {
      lines.push(`  ${c.doc} — ${c.note}`);
      continue;
    }
    const mark = c.matches ? 'ok   ' : 'DRIFT';
    const approx = c.approx ? '~' : ' ';
    lines.push(`  ${String(c.doc + ':' + c.line).padEnd(38)} claimed ${approx}${String(c.claimed).padEnd(4)} [${mark}] real ${audit.real}`);
  }
  lines.push('');
  lines.push(`drift: ${audit.drift.length} entr${audit.drift.length === 1 ? 'y' : 'ies'}`);
  for (const d of audit.drift) lines.push(`  - ${d.message}`);
  lines.push('');
  lines.push(`audit: ${audit.ok ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
}

function main(argv) {
  const json = argv.includes('--json');
  const audit = runAudit();
  if (json) {
    console.log(JSON.stringify(audit, null, 2));
  } else {
    console.log(renderText(audit));
  }
  process.exit(audit.ok ? 0 : 1);
}

// Run as CLI only when executed directly (not when imported as a library).
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main(process.argv.slice(2));
