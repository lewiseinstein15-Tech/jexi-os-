/**
 * M6 — INDEPENDENT JUDGE GATE for autonomous code output.
 *
 * The coder used to verify itself ("verified by running" was the same
 * model's own claim). The judge is independent: deterministic checks that
 * run offline (file exists, non-empty, JS syntax via node --check) plus
 * the existing reviewer/security gate passes when a model is available.
 *
 * Verdicts are honest: PASS | FAIL | UNKNOWN. UNKNOWN means the checks
 * are green but no independent model review could run — it is never
 * presented as a pass.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const MAX_JUDGED_FILES = 20;
const MAX_FILE_BYTES = 300000;

/**
 * Deterministic checks over delivered files (offline, no model).
 * @param {string} workspaceDir live staging area the paths resolve against
 * @param {string[]} files workspace-relative file paths
 * @returns {Array<{name, pass, detail}>}
 */
export function deterministicCodeChecks(workspaceDir, files = []) {
  const checks = [];
  const root = path.resolve(String(workspaceDir || ''));
  const list = (files || []).map((f) => String(f || '')).filter(Boolean).slice(0, MAX_JUDGED_FILES);
  if (!list.length) {
    return [{ name: 'files-delivered', pass: false, detail: 'no files were delivered — nothing to judge' }];
  }
  for (const rel of list) {
    const target = path.resolve(root, rel.replace(/^\/+/, ''));
    if (!target.startsWith(root + path.sep) && target !== root) {
      checks.push({ name: `escape:${rel}`, pass: false, detail: `path escapes the workspace: ${rel}` });
      continue;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      checks.push({ name: `exists:${rel}`, pass: false, detail: `claimed file is missing: ${rel}` });
      continue;
    }
    checks.push({ name: `exists:${rel}`, pass: true, detail: 'delivered file is present' });
    let size = 0;
    try { size = fs.statSync(target).size; } catch { /* stat failed below */ }
    if (!size) {
      checks.push({ name: `nonempty:${rel}`, pass: false, detail: `file is empty: ${rel}` });
      continue;
    }
    checks.push({ name: `nonempty:${rel}`, pass: true, detail: `${size} bytes` });
    if (size > MAX_FILE_BYTES) continue; // too big to syntax-check; presence is the claim
    if (/\.m?jsx?$/.test(rel)) {
      try {
        execFileSync(process.execPath, ['--check', target], { timeout: 10000, stdio: 'pipe' });
        checks.push({ name: `syntax:${rel}`, pass: true, detail: 'node --check passed' });
      } catch (e) {
        const msg = String((e && e.stderr) || (e && e.message) || 'syntax error').slice(0, 220).replace(/\s+/g, ' ');
        checks.push({ name: `syntax:${rel}`, pass: false, detail: `node --check failed: ${msg}` });
      }
    }
  }
  return checks;
}

/**
 * Combine deterministic checks + independent model verdicts into one gate.
 * @param {{checks: Array, reviewVerdict: string|null, secVerdict: string|null}} o
 * @returns {{verdict: 'PASS'|'FAIL'|'UNKNOWN', reasons: string[]}}
 */
export function judgeVerdict({ checks = [], reviewVerdict = null, secVerdict = null } = {}) {
  const reasons = [];
  const failed = checks.filter((c) => !c.pass);
  if (failed.length) {
    reasons.push(`${failed.length} deterministic check(s) failed: ${failed.map((c) => c.name).join(', ')}`);
    return { verdict: 'FAIL', reasons };
  }
  reasons.push(`${checks.length} deterministic check(s) green`);
  if (reviewVerdict === 'NEEDS WORK') reasons.push('reviewer: NEEDS WORK');
  if (secVerdict === 'BLOCKED') reasons.push('security: BLOCKED');
  if (reviewVerdict === 'NEEDS WORK' || secVerdict === 'BLOCKED') {
    return { verdict: 'FAIL', reasons };
  }
  if (reviewVerdict == null && secVerdict == null) {
    reasons.push('no independent model review ran (reviewer unavailable)');
    return { verdict: 'UNKNOWN', reasons };
  }
  if (reviewVerdict) reasons.push(`reviewer: ${reviewVerdict}`);
  else reasons.push('reviewer: unavailable');
  if (secVerdict) reasons.push(`security: ${secVerdict}`);
  else reasons.push('security: unavailable');
  return { verdict: 'PASS', reasons };
}
