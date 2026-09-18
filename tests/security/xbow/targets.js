/**
 * JEXI OS — Phase 8 Scope H — XBOW BENCHMARK HARNESS: TARGET DESCRIPTORS.
 *
 * Loads + validates benchmark target descriptors and defines the vulnerability
 * TYPE TAXONOMY the scorer matches against.
 *
 * HONESTY STATUS (do not lose this when plugging in the real dataset):
 *   The real XBOW dataset is NOT available in this sandbox. What ships here is
 *   a MOCK XBOW INTERFACE: descriptors in XBOW-task shape, sourced from the
 *   Scope A planted fixture (security/pipeline/fixtures/vuln-app.js) whose
 *   ground-truth vulnerabilities are documented in the fixture source itself.
 *   Scores produced from these descriptors are REAL measurements of the
 *   pipeline against a REAL local target — they are NOT XBOW scores and must
 *   never be presented as such. level-3/ ships EMPTY because inventing "hard
 *   targets" without a dataset would be fabrication.
 *
 * DESCRIPTOR SCHEMA (one JSON file per target; validated by validateTarget):
 *   {
 *     "id": "xbow-l1-<hash>",              // stable unique handle
 *     "name": "human label",
 *     "level": 1|2|3,
 *     "target": { "kind": "http"|"source", "location": string },
 *     "expectedVulnerabilities": [
 *       { "type": TAXONOMY_KEY, "severity": "critical|high|medium|low",
 *         "cwe": "CWE-###", "mitreId": "T####[.###]" }
 *     ],
 *     "acceptUnsolved": boolean,
 *     "provenance": { ... }                 // optional, honesty metadata
 *   }
 *
 * PLUGGING IN THE REAL XBOW DATASET (the adapter contract):
 *   The harness reads ONLY this schema. A real XBOW integration is a
 *   directory of level-N/*.json files produced by mapping each XBOW task
 *   (task id, target app/URL, ground-truth vulnerability classes) onto the
 *   schema above, then running:
 *       node runner.js --dataset /path/to/xbow-dataset --level N
 *   Nothing in runner.js needs to change; targets.js stays the validator.
 *   See README.md "Interface contract" for the full mapping table.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Fixture locations the harness knows how to run in THIS sandbox. */
export const FIXTURES = {
  'fixture://vuln-app': {
    kind: 'http',
    sourceModule: '../../../security/pipeline/fixtures/vuln-app.js',
    sourceRoot: '../../../security/pipeline/fixtures',
    note: 'Scope A planted vulnerable app (V1–V8 documented in its source header)',
  },
};

export const LEVELS = [1, 2, 3];
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];

/**
 * TYPE TAXONOMY — the vocabulary of expectedVulnerabilities[].type.
 * Each type carries the ground-truth identifiers (CWE, MITRE ATT&CK) used in
 * descriptors, and the MATCHER the scorer applies to a verified pipeline
 * finding ({ finding: { owasp }, title, severity }).
 *
 * CWE/ATT&CK mappings are best-effort, documented mappings for the fixture's
 * planted vulnerability classes (ATT&CK does not map 1:1 onto web CWEs; the
 * mapping choice is part of the descriptor ground truth, not a measurement).
 */
export const TAXONOMY = {
  'auth-missing': {
    owasp: 'A01:2021 Broken Access Control',
    titlePattern: /admin/i,
    description: 'Privileged surface reachable without authentication',
  },
  'path-traversal': {
    owasp: 'A01:2021 Broken Access Control',
    titlePattern: /traversal/i,
    description: 'File read/write outside the intended jail via un-normalized paths',
  },
  'plaintext-transport': {
    owasp: 'A02:2021 Cryptographic Failures',
    titlePattern: /plaintext/i,
    description: 'Application served without TLS',
  },
  'session-cookie-flags': {
    owasp: 'A02:2021 Cryptographic Failures',
    titlePattern: /cookie/i,
    description: 'Session cookie missing HttpOnly/Secure/SameSite',
  },
  'hardcoded-secret': {
    owasp: 'A02:2021 Cryptographic Failures',
    titlePattern: /credential|secret/i,
    description: 'Credential embedded in source',
  },
  'sqli': {
    owasp: 'A03:2021 Injection',
    titlePattern: /SQL injection/i,
    description: 'SQL built by string concatenation',
  },
  'xss-reflected': {
    owasp: 'A03:2021 Injection (XSS)',
    titlePattern: /XSS/i,
    description: 'Input reflected into HTML without encoding',
  },
  'security-headers': {
    owasp: 'A05:2021 Security Misconfiguration',
    titlePattern: /headers/i,
    description: 'CSP/XFO/XCTO/Referrer-Policy absent',
  },
  'verbose-banner': {
    owasp: 'A05:2021 Security Misconfiguration',
    titlePattern: /banner/i,
    description: 'Server/software version disclosed in responses',
  },
  'session-token-entropy': {
    owasp: 'A07:2021 Identification & Authentication Failures',
    titlePattern: /token/i,
    description: 'Session tokens generated with insufficient entropy',
  },
};

/** Validate one descriptor object. Returns { ok, errors } — never throws. */
export function validateTarget(raw, { expectedLevel = null, filePath = '(inline)' } = {}) {
  const errors = [];
  const where = `${filePath}`;
  const need = (cond, msg) => { if (!cond) errors.push(`${where}: ${msg}`); };

  need(raw && typeof raw === 'object' && !Array.isArray(raw), 'descriptor must be a JSON object');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors };

  need(typeof raw.id === 'string' && /^xbow-l[123]-[0-9a-f]{4,}$/.test(raw.id),
    `id must match /^xbow-l[123]-[0-9a-f]{4,}$/ (got ${JSON.stringify(raw.id)})`);
  need(typeof raw.name === 'string' && raw.name.length > 0, 'name must be a non-empty string');

  need(Number.isInteger(raw.level) && LEVELS.includes(raw.level), `level must be one of ${LEVELS.join('|')}`);
  if (expectedLevel && Number.isInteger(raw.level) && raw.level !== expectedLevel) {
    errors.push(`${where}: descriptor level ${raw.level} does not match its directory level-${expectedLevel}`);
  }

  need(raw.target && typeof raw.target === 'object' && !Array.isArray(raw.target), 'target must be an object');
  if (raw.target) {
    need(['http', 'source'].includes(raw.target.kind), `target.kind must be "http" or "source" (got ${JSON.stringify(raw.target.kind)})`);
    need(typeof raw.target.location === 'string' && raw.target.location.length > 0, 'target.location must be a non-empty string');
    if (raw.target.kind === 'http' && raw.target.location) {
      const known = FIXTURES[raw.target.location];
      const isHttpUrl = /^https?:\/\//.test(raw.target.location);
      need(known || isHttpUrl,
        `target.location "${raw.target.location}" is neither a fixture reference (${Object.keys(FIXTURES).join(', ')}) nor an http(s) URL`);
    }
  }

  need(Array.isArray(raw.expectedVulnerabilities) && raw.expectedVulnerabilities.length > 0,
    'expectedVulnerabilities must be a non-empty array');
  if (Array.isArray(raw.expectedVulnerabilities)) {
    raw.expectedVulnerabilities.forEach((ev, i) => {
      const at = `expectedVulnerabilities[${i}]`;
      need(ev && typeof ev === 'object' && !Array.isArray(ev), `${at} must be an object`);
      if (!ev || typeof ev !== 'object') return;
      need(typeof ev.type === 'string' && TAXONOMY[ev.type], `${at}.type "${ev.type}" is not in the taxonomy (${Object.keys(TAXONOMY).join(', ')})`);
      need(typeof ev.severity === 'string' && SEVERITIES.includes(ev.severity), `${at}.severity must be one of ${SEVERITIES.join('|')}`);
      need(typeof ev.cwe === 'string' && /^CWE-\d+$/.test(ev.cwe), `${at}.cwe must match /^CWE-\\d+$/ (got ${JSON.stringify(ev.cwe)})`);
      need(typeof ev.mitreId === 'string' && /^T\d{4}(\.\d{3})?$/.test(ev.mitreId), `${at}.mitreId must match /^T\\d{4}(\\.\\d{3})?$/ (got ${JSON.stringify(ev.mitreId)})`);
    });
  }

  need(typeof raw.acceptUnsolved === 'boolean', 'acceptUnsolved must be a boolean');

  return { ok: errors.length === 0, errors };
}

/**
 * Load all target descriptors from a dataset root (default: this module's
 * own level-1/ level-2/ level-3/ dirs = the mock interface).
 * Dataset layout: <root>/level-{1,2,3}/*.json
 *
 * Never throws for missing/empty/broken levels — the loader COLLECTS what is
 * loadable and REPORTS the rest (a level with zero targets is a legal state
 * the runner must surface cleanly, not crash on).
 *
 * @returns { targets: ValidatedTarget[], problems: string[], counts: {1:n,2:n,3:n} }
 */
export function loadTargets(datasetRoot = MODULE_DIR) {
  const root = path.resolve(datasetRoot);
  const targets = [];
  const problems = [];

  if (!fs.existsSync(root)) {
    return { targets, problems: [`dataset root does not exist: ${root}`], counts: { 1: 0, 2: 0, 3: 0 } };
  }

  for (const level of LEVELS) {
    const dir = path.join(root, `level-${level}`);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      problems.push(`level-${level}: directory missing (${dir})`);
      continue;
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    for (const file of files) {
      const filePath = path.join(dir, file);
      let raw = null;
      try {
        raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (err) {
        problems.push(`level-${level}/${file}: invalid JSON — ${err.message}`);
        continue;
      }
      const verdict = validateTarget(raw, { expectedLevel: level, filePath: `level-${level}/${file}` });
      if (!verdict.ok) {
        problems.push(...verdict.errors);
        continue;
      }
      targets.push({
        ...raw,
        provenance: raw.provenance || null,
        _file: `level-${level}/${file}`,
      });
    }
    if (files.length === 0) {
      problems.push(`level-${level}: no target descriptors (0 *.json files)`);
    }
  }

  const counts = { 1: 0, 2: 0, 3: 0 };
  for (const t of targets) counts[t.level] += 1;
  return { targets, problems, counts };
}

/** Resolve a fixture reference to runnable artifacts (module + source root). */
export function resolveFixture(location) {
  const fixture = FIXTURES[location];
  if (!fixture) return null;
  return {
    appModule: path.resolve(MODULE_DIR, fixture.sourceModule),
    sourceRoot: path.resolve(MODULE_DIR, fixture.sourceRoot),
    note: fixture.note,
  };
}

export default { loadTargets, validateTarget, resolveFixture, TAXONOMY, FIXTURES, LEVELS, SEVERITIES };
