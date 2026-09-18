/**
 * JEXI OS — HARD GATES — shared state: the append-only audit log.
 *
 * Every gate verdict (allow AND block) is recorded as one JSONL line so a
 * run can be audited after the fact ("show me the audit log recorded the
 * block"). Default sink is the OS tempdir; override with JEXI_GATE_AUDIT.
 * Never throws — a logging failure must not soften a block.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const AUDIT_PATH = process.env.JEXI_GATE_AUDIT
  || path.join(os.tmpdir(), 'jexi-gate-audit.jsonl');

export function appendAudit(entry) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    fs.appendFileSync(AUDIT_PATH, line + '\n');
  } catch {
    /* audit sink unavailable — never blocks or softens a gate verdict */
  }
  return entry;
}

export function readAudit() {
  try {
    return fs.readFileSync(AUDIT_PATH, 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
