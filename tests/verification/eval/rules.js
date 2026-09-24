'use strict';

/*
 * verification/eval/rules.js
 * Effect class registry + redaction rules for the JEXI OS eval harness.
 * Phase 7 Scope E - follows the ECC eval-harness reference.
 *
 * Effect classes (SE = Side Effect level):
 *   SE0 - pure, no side effects (compute, read memory)
 *   SE1 - read-only IO (read file, HTTP GET)
 *   SE2 - local write (write file, write DB)
 *   SE3 - external write (git push, HTTP POST, email)
 *   SE4 - irreversible (delete remote, send payment)
 */

const crypto = require('crypto');

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/*
 * Deterministic JSON: object keys sorted, arrays in order. Same inputs
 * always produce the same bytes - this is what makes capsule hashes and
 * receipt signatures reproducible across runs (probe P8).
 */
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

const EFFECT_CLASSES = Object.freeze({
  SE0: Object.freeze({ level: 0, name: 'pure',           description: 'pure, no side effects (compute, read memory)' }),
  SE1: Object.freeze({ level: 1, name: 'read-only-io',   description: 'read-only IO (read file, HTTP GET)' }),
  SE2: Object.freeze({ level: 2, name: 'local-write',    description: 'local write (write file, write DB)' }),
  SE3: Object.freeze({ level: 3, name: 'external-write', description: 'external write (git push, HTTP POST, email)' }),
  SE4: Object.freeze({ level: 4, name: 'irreversible',   description: 'irreversible (delete remote, send payment)' }),
});

function normalizeEffect(cls) {
  if (typeof cls !== 'string') {
    throw new TypeError('effect class must be a string, got ' + typeof cls);
  }
  const key = cls.toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(EFFECT_CLASSES, key)) {
    throw new Error('unknown effect class: ' + cls + ' (expected SE0..SE4)');
  }
  return key;
}

function effectLevel(cls) {
  return EFFECT_CLASSES[normalizeEffect(cls)].level;
}

/* true when an action of class `cls` may run under a declared max of `maxCls` */
function effectAllowed(cls, maxCls) {
  return effectLevel(cls) <= effectLevel(maxCls);
}

/*
 * Effect classification of tool invocations - used when a step does not
 * declare its own effect class. Same philosophy as the Scope D shield:
 * classify BEFORE you execute.
 */
const EFFECT_PATTERNS = Object.freeze([
  { re: /\bgit\s+push\b/,                                        effect: 'SE3' },
  { re: /\b(npm|yarn|pnpm|bun)\s+(publish|push)\b/,              effect: 'SE3' },
  { re: /\b(curl|wget)\b[^|;&]*\s(-d|--data|-F|--form|-T|-X\s*(POST|PUT|PATCH|DELETE))/, effect: 'SE3' },
  { re: /\bsendmail\b|\bsmtp\b/i,                                effect: 'SE3' },
  { re: /\brm\s+-[a-zA-Z]*[rf]/,                                 effect: 'SE4' },
  { re: /\b(payment|charge|refund)\b/i,                          effect: 'SE4' },
  { re: /\b(write|append|create)\s+file\b/i,                     effect: 'SE2' },
  { re: /\b(read|cat|list|stat)\s+file\b/i,                      effect: 'SE1' },
  { re: /\b(curl|wget|fetch)\b/i,                                effect: 'SE1' },
  { re: /\bcompute\b/i,                                          effect: 'SE0' },
]);

function inferEffect(tool, args) {
  const haystack = String(tool || '') + ' ' + canonicalStringify(args || {});
  for (const { re, effect } of EFFECT_PATTERNS) {
    if (re.test(haystack)) return effect;
  }
  const t = String(tool || '').toLowerCase();
  if (t.includes('read') || t.includes('get') || t.includes('list') || t.includes('stat')) return 'SE1';
  if (t.includes('write') || t.includes('create') || t.includes('append')) return 'SE2';
  if (t.includes('exec') || t.includes('run') || t.includes('push') || t.includes('delete')) return 'SE3';
  /*
   * Default for tool names the registry does not know. Safe here because
   * performIO() in replay.js is a CLOSED switch: an unknown tool never
   * reaches an executor - it throws. Pure default, no side effect.
   */
  return 'SE0';
}

/* ------------------------------------------------------------------ */
/* Redaction                                                           */
/* ------------------------------------------------------------------ */

const REDACTION_PATTERNS = Object.freeze([
  { name: 'anthropic-key',  re: /sk-ant-[A-Za-z0-9_-]{16,}/g },
  { name: 'openai-key',     re: /sk-(?!ant-)[A-Za-z0-9_-]{16,}/g },
  { name: 'github-token',   re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'slack-token',    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'stripe-key',     re: /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: 'bearer-token',   re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g },
  { name: 'query-secret',   re: /([?&](?:key|token|secret|password|api_?key)=)[^&\s"']+/gi },
]);

function redact(text) {
  let out = String(text == null ? '' : text);
  for (const { name, re } of REDACTION_PATTERNS) {
    // only the query-secret rule owns a capture group; for group-less
    // patterns the 2nd callback arg is the match OFFSET (a number)
    out = out.replace(re, (m, p1) => (typeof p1 === 'string' ? p1 + '[REDACTED:' + name + ']' : '[REDACTED:' + name + ']'));
  }
  return out;
}

module.exports = {
  sha256,
  canonicalStringify,
  EFFECT_CLASSES,
  normalizeEffect,
  effectLevel,
  effectAllowed,
  EFFECT_PATTERNS,
  inferEffect,
  REDACTION_PATTERNS,
  redact,
};
