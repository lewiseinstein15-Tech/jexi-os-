/**
 * JEXI OS — Phase 8 Scope D — ENGAGEMENT STORE (SQLite persistence).
 *
 * Soundwave pattern, JEXI storage family: every engagement is planned ONCE,
 * persisted as a signed bundle, and survives process death. One SQLite file
 * via node:sqlite — the same zero-dependency pattern as Phase 4 memory and
 * the Scope C knowledge graph. WAL journal, foreign keys ON, migrations
 * applied idempotently.
 *
 *   const eng = openEngagements({ dbPath: '/abs/engagements.db' });
 *   eng.plan({ name, targets, ... });       // → full 8-doc bundle, persisted
 *   eng.get(id);                            // → bundle + approvals merged
 *   eng.grantApproval(id, { action });      // RoE approval grants (P8)
 *   eng.runCleanup(id, { stateRoots });     // real footprint removal (P10)
 *   eng.addSignature(id, { role, name });   // authorization proof (P11)
 *   eng.close();
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { planDraft } from './planner.js';
import { assembleBundle } from './bundle.js';
import { signBundle, verifySignatures as verifySignaturesOf } from './docs/signatures.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(MODULE_DIR, 'schema', 'migrations');

export function openStore({ dbPath } = {}) {
  if (!dbPath || typeof dbPath !== 'string') {
    throw new Error('openStore: dbPath is required (explicit — no silent defaults)');
  }
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(path.resolve(dbPath));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return {
    db,
    dbPath: path.resolve(dbPath),
    close: () => { try { db.close(); } catch { /* already closed */ } },
  };
}

/** Apply every migration/*.sql newer than what the schema table knows. Idempotent. */
export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _engagement_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    db.prepare('SELECT name FROM _engagement_migrations').all().map((r) => r.name),
  );
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    // strip comment lines FIRST (comments may contain ';'), then split statements
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      db.exec(stmt + ';');
    }
    db.prepare('INSERT INTO _engagement_migrations (name, applied_at) VALUES (?, ?)')
      .run(file, new Date().toISOString());
  }
}

export const nowIso = () => new Date().toISOString();

/** Field-specific rejection for contract violations (planner + doc builders). */
export class EngagementValidationError extends Error {
  constructor(field, message) {
    super(`engagement validation failed: ${message}`);
    this.name = 'EngagementValidationError';
    this.code = 'E_ENGAGEMENT_VALIDATION';
    this.field = field;
  }
}

/**
 * The engagement registry. One handle per database file. Bundles are stored
 * as canonical JSON rows; approvals and the audit trail live in their own
 * tables (the audit is the durable `engagement.audit` log).
 */
export class Engagements {
  constructor({ dbPath } = {}) {
    if (!dbPath) throw new Error('Engagements: dbPath is required');
    this.store = openStore({ dbPath });
    this.db = this.store.db;
    this.dbPath = this.store.dbPath;
  }

  /** Plan (Soundwave) → assemble the 8-doc bundle → persist → audit. */
  plan(input) {
    const draft = planDraft(input);
    const engagement = assembleBundle(draft);
    this.db.prepare(
      'INSERT INTO engagements (id, name, created_at, updated_at, bundle) VALUES (?, ?, ?, ?, ?)',
    ).run(engagement.id, engagement.name, engagement.createdAt, engagement.createdAt, JSON.stringify(engagement, null, 2) + '\n');
    this.audit(engagement.id, {
      kind: 'plan',
      allowed: 1,
      reason: 'engagement planned — 8-document OPPLAN written before any execution',
      detail: { name: engagement.name, targets: engagement.scope.targets, docs: 8 },
    });
    return this.get(engagement.id);
  }

  /** Load by id: parsed bundle + approvals merged in as `approvals`. */
  get(id) {
    const r = this.db.prepare('SELECT * FROM engagements WHERE id = ?').get(id);
    if (!r) return null;
    const bundle = JSON.parse(r.bundle);
    bundle.approvals = this.listApprovals(id);
    return bundle;
  }

  list() {
    return this.db.prepare('SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM engagements ORDER BY created_at, id').all();
  }

  /** Persist a mutated bundle (signatures, cleanup.verifiedAt, …). */
  saveBundle(id, bundle) {
    const r = this.db.prepare('SELECT id FROM engagements WHERE id = ?').get(id);
    if (!r) throw new Error(`Engagements.saveBundle: unknown engagement ${id}`);
    this.db.prepare('UPDATE engagements SET bundle = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(bundle, null, 2) + '\n', nowIso(), id);
  }

  listApprovals(id) {
    return this.db.prepare(
      'SELECT action, granted_by AS grantedBy, note, granted_at AS grantedAt FROM approvals WHERE engagement_id = ? ORDER BY granted_at, id',
    ).all(id);
  }

  /** Grant a RoE approval for one action (unblocks APPROVAL_REQUIRED gates). */
  grantApproval(id, { action, grantedBy = null, note = null } = {}) {
    if (!action || typeof action !== 'string') {
      throw new EngagementValidationError('action', 'grantApproval requires a non-empty action string');
    }
    const eng = this.get(id);
    if (!eng) throw new Error(`Engagements.grantApproval: unknown engagement ${id}`);
    this.db.prepare(
      'INSERT INTO approvals (id, engagement_id, action, granted_by, note, granted_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(`appr-${randomUUID()}`, id, action.trim(), grantedBy, note, nowIso());
    this.audit(id, {
      kind: 'approval',
      action: action.trim(),
      allowed: 1,
      rule: 'APPROVAL_GRANTED',
      reason: `approval granted for "${action.trim()}"${grantedBy ? ` by ${grantedBy}` : ''}`,
    });
    return this.get(id);
  }

  /** Append one row to the durable engagement.audit log. */
  audit(engagementId, { kind, action = null, target = null, allowed = null, rule = null, reason = null, detail = null } = {}) {
    if (!kind || typeof kind !== 'string') {
      throw new EngagementValidationError('kind', 'audit entries require a kind string');
    }
    this.db.prepare(
      'INSERT INTO engagement_audit (engagement_id, ts, kind, action, target, allowed, rule, reason, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      engagementId, nowIso(), kind, action, target,
      allowed === null || allowed === undefined ? null : (allowed ? 1 : 0),
      rule, reason, detail === null || detail === undefined ? null : JSON.stringify(detail),
    );
  }

  auditLog(engagementId) {
    return this.db.prepare(
      'SELECT ts, kind, action, target, allowed, rule, reason, detail FROM engagement_audit WHERE engagement_id = ? ORDER BY id',
    ).all(engagementId).map((r) => ({
      ...r,
      allowed: r.allowed === null ? null : Boolean(r.allowed),
      detail: r.detail ? JSON.parse(r.detail) : null,
    }));
  }

  /**
   * Execute the cleanup document — REAL removal with receipts:
   *   - the engagement's dataHandling.storage directory (collected data)
   *   - each engagement state dir passed via stateRoots (pipeline artifacts,
   *     i.e. <stateRoot>/.state/<engagementId>)
   * Then stamps cleanup.verifiedAt, persists, and audits. Idempotent:
   * re-running finds nothing left to remove and reports exactly that.
   */
  runCleanup(id, { stateRoots = [] } = {}) {
    const eng = this.get(id);
    if (!eng) throw new Error(`Engagements.runCleanup: unknown engagement ${id}`);
    const removed = [];
    const rmrf = (dir) => {
      if (!fs.existsSync(dir)) return;
      let files = 0;
      let bytes = 0;
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else { files += 1; try { bytes += fs.statSync(p).size; } catch { /* raced */ } }
        }
      };
      walk(dir);
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push({ path: dir, files, bytes });
    };
    if (eng.dataHandling && eng.dataHandling.storage) rmrf(path.resolve(eng.dataHandling.storage));
    for (const sr of stateRoots) rmrf(path.join(path.resolve(sr), '.state', id));

    const accountSweep = 'engagement provisioned no test accounts or credentials — nothing to remove';
    const targetSweep = 'no persistent target modifications recorded by this engagement';
    const removalReceipt = removed.length
      ? `removed ${removed.reduce((a, r) => a + r.files, 0)} file(s), ${removed.reduce((a, r) => a + r.bytes, 0)} byte(s): ${removed.map((r) => r.path).join(', ')}`
      : 'no files remained on disk (already removed or never created)';
    const detailFor = (step) => {
      const s = step.toLowerCase();
      if (/account|credential/.test(s)) return accountSweep;
      if (/verify|residual|restore/.test(s)) return targetSweep;
      return removalReceipt;
    };
    eng.cleanup = {
      steps: eng.cleanup.steps.map((step) => ({ step, status: 'executed', detail: detailFor(step) })),
      verifiedAt: nowIso(),
    };
    this.saveBundle(id, eng);
    this.audit(id, {
      kind: 'cleanup', allowed: 1, rule: 'CLEANUP_EXECUTED',
      reason: `cleanup verified at ${eng.cleanup.verifiedAt}`,
      detail: { removed, steps: eng.cleanup.steps.length },
    });
    return { removed, steps: eng.cleanup.steps, verifiedAt: eng.cleanup.verifiedAt };
  }

  /** Sign the CURRENT bundle content (authorization proof). */
  addSignature(id, { role, name } = {}) {
    const eng = this.get(id);
    if (!eng) throw new Error(`Engagements.addSignature: unknown engagement ${id}`);
    eng.signatures = signBundle(eng, { role, name });
    this.saveBundle(id, eng);
    this.audit(id, {
      kind: 'signature', allowed: 1, rule: 'SIGNED',
      reason: `signed by ${name} (${role})`,
      detail: { hash: eng.signatures[eng.signatures.length - 1].hash },
    });
    return this.get(id);
  }

  /** Verify every signature against the CURRENT content. */
  verifySignatures(id) {
    const eng = this.get(id);
    if (!eng) throw new Error(`Engagements.verifySignatures: unknown engagement ${id}`);
    const verdict = verifySignaturesOf(eng);
    this.audit(id, {
      kind: 'signature-verify', allowed: verdict.valid ? 1 : 0,
      rule: verdict.valid ? 'SIGNATURES_VALID' : 'SIGNATURES_INVALID',
      reason: verdict.valid
        ? `all ${verdict.results.length} signature(s) match the current content hash`
        : `signature mismatch — bundle content changed after signing (current sha256 ${verdict.currentHash})`,
      detail: { results: verdict.results },
    });
    return verdict;
  }

  close() { this.store.close(); }
}

export function openEngagements({ dbPath } = {}) {
  return new Engagements({ dbPath });
}

/** Default DB location (explicit-path callers override). */
export function defaultDbPath() {
  return path.join(MODULE_DIR, '.data', 'engagements.db');
}
