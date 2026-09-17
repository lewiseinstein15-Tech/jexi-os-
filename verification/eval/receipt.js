'use strict';

/*
 * verification/eval/receipt.js
 *
 * Offline receipt over the capsule root + artifact digest:
 *   {
 *     capsuleRoot:    sha256 of the final capsule hash
 *     artifactDigest: sha256 of the eval artifact
 *     gateReceipt:    { sources, warnings }
 *     issuedAt:       timestamp
 *     signature:      HMAC-SHA256 over the canonical body with a local key
 *   }
 *
 * Verification is OFFLINE: pure local computation - no network, no
 * server, no external state (probes P9 / P10). The key never leaves
 * the machine and is never printed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sha256, canonicalStringify } = require('./rules');

function loadReceiptKey(keyPath) {
  const abs = path.resolve(keyPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) {
    fs.writeFileSync(abs, crypto.randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
  }
  try { fs.chmodSync(abs, 0o600); } catch (_) { /* best effort */ }
  return String(fs.readFileSync(abs, 'utf8')).trim();
}

function receiptBody(receipt) {
  return {
    capsuleRoot: receipt.capsuleRoot,
    artifactDigest: receipt.artifactDigest,
    gateReceipt: receipt.gateReceipt,
    issuedAt: receipt.issuedAt,
  };
}

function sign(body, key) {
  return crypto.createHmac('sha256', key).update(canonicalStringify(body)).digest('hex');
}

function artifactDigestOf(artifact) {
  if (artifact === null || artifact === undefined) return null;
  return sha256(Buffer.isBuffer(artifact) ? artifact : String(artifact));
}

function issueReceipt({ capsule, artifact = '', gate = { sources: [], warnings: [] }, key, now = () => new Date().toISOString() } = {}) {
  if (!capsule || typeof capsule.root !== 'function') throw new TypeError('issueReceipt requires a Capsule');
  if (typeof key !== 'string' || !key.length) throw new TypeError('issueReceipt requires a local HMAC key');
  const capsuleRoot = capsule.root();
  const artifactDigest = artifactDigestOf(artifact);
  const gateReceipt = { sources: gate.sources, warnings: gate.warnings };
  const issuedAt = now();
  const receipt = { capsuleRoot, artifactDigest, gateReceipt, issuedAt };
  receipt.signature = sign(receiptBody(receipt), key);
  return receipt;
}

/*
 * Offline verification. Order of checks:
 *   1. structural completeness
 *   2. capsuleRoot recomputed from the capsule (when provided)
 *   3. artifactDigest recomputed from the artifact (when provided)
 *   4. HMAC signature over the canonical body
 */
function verifyReceipt(receipt, { key, capsule = null, artifact = null } = {}) {
  if (!receipt || typeof receipt !== 'object') return { ok: false, reason: 'receipt is not an object' };
  for (const field of ['capsuleRoot', 'artifactDigest', 'gateReceipt', 'issuedAt', 'signature']) {
    if (receipt[field] === undefined) return { ok: false, reason: 'receipt missing field: ' + field };
  }
  if (capsule) {
    if (!capsule || typeof capsule.root !== 'function') return { ok: false, reason: 'capsule argument is not a Capsule' };
    const recomputed = capsule.root();
    if (recomputed !== receipt.capsuleRoot) {
      return {
        ok: false,
        reason: 'capsuleRoot mismatch (receipt ' + String(receipt.capsuleRoot).slice(0, 16) +
                '..., recomputed ' + String(recomputed).slice(0, 16) + '...)',
      };
    }
  }
  if (artifact !== null) {
    const recomputed = artifactDigestOf(artifact);
    if (recomputed !== receipt.artifactDigest) {
      return {
        ok: false,
        reason: 'artifactDigest mismatch (receipt ' + String(receipt.artifactDigest).slice(0, 16) +
                '..., recomputed ' + String(recomputed).slice(0, 16) + '...)',
      };
    }
  }
  const expected = sign(receiptBody(receipt), key);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(receipt.signature), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature mismatch - receipt body was altered after issuance' };
  }
  return { ok: true, offline: true, capsuleRoot: receipt.capsuleRoot, artifactDigest: receipt.artifactDigest };
}

module.exports = { issueReceipt, verifyReceipt, loadReceiptKey, artifactDigestOf };
