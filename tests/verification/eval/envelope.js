'use strict';

/*
 * verification/eval/envelope.js
 *
 * The envelope is declared BEFORE the eval runs:
 *   {
 *     evalId:    unique
 *     effectMax: SE0 | SE1 | SE2 | SE3 | SE4
 *     canaries:  [{ name, valueHash }]   # secrets that must not appear in output
 *     inputs:    [{ path, sha256 }]
 *     startedAt: timestamp
 *   }
 *
 * - effectMax bounds every side effect the eval may take (SE0..SE4).
 * - Canary RAW values are hashed at creation time and NEVER stored -
 *   the envelope keeps sha256(value) only. Detection is hash-compare,
 *   never a plaintext scan (STEP 2 contract).
 */

const fs = require('fs');
const path = require('path');
const { sha256, normalizeEffect, effectAllowed, EFFECT_CLASSES, canonicalStringify } = require('./rules');

class EnvelopeRefusedError extends Error {
  constructor(msg) { super(msg); this.name = 'EnvelopeRefusedError'; }
}

class CanaryLeakError extends Error {
  constructor(msg) { super(msg); this.name = 'CanaryLeakError'; }
}

/* ---------------- canary detection (hash-compare only) ---------------- */

const WINDOW_MIN = 8;      // shortest substring we will hash-compare
const WINDOW_MAX = 256;    // longest  substring we will hash-compare
const TEXT_CAP = 262144;   // 256 KiB cap per text blob

function collectStrings(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}

function tokensOf(text) {
  return String(text).split(/[\s"'`,;:(){}[\]<>=\\|/!?*&@#$%^~+-]+/).filter(Boolean);
}

/*
 * Hash-compare: returns true when some substring of `text` hashes to
 * `valueHash`. The raw canary value is NOT known here - only its
 * sha256 - so we hash candidate windows and compare digests.
 * Fast paths: exact structured strings, whole lines, tokens.
 * Fallback: sliding windows of length WINDOW_MIN..WINDOW_MAX.
 */
function hashPresent(text, valueHash) {
  if (!text) return false;
  const strings = [text].concat(String(text).split(/\r?\n/), tokensOf(text));
  for (const s of strings) {
    if (s.length >= 8 && s.length <= 4096 && sha256(s) === valueHash) return true;
  }
  const t = text.length > TEXT_CAP ? text.slice(0, TEXT_CAP) : text;
  for (let len = WINDOW_MIN; len <= WINDOW_MAX; len++) {
    for (let i = 0; i + len <= t.length; i++) {
      if (sha256(t.slice(i, i + len)) === valueHash) return true;
    }
  }
  return false;
}

function findCanaryLeaks(input, canaries) {
  const leaks = [];
  for (const canary of canaries) {
    let hit = false;
    if (Array.isArray(input)) {
      const strings = collectStrings(input, []);
      for (const s of strings) {
        if (s.length >= 8 && sha256(s) === canary.valueHash) { hit = true; break; }
      }
    }
    if (!hit && typeof input === 'string') {
      hit = hashPresent(input, canary.valueHash);
    }
    if (hit) leaks.push(canary.name);
  }
  return leaks;
}

/* ------------------------------ envelope ------------------------------ */

function createEnvelope({ name = 'eval', evalId = null, effectMax, canaries = [], inputs = [], now = () => new Date().toISOString() } = {}) {
  const max = normalizeEffect(effectMax);

  // evalId unique per eval program + effect bound + input digests
  // (deterministic derivation - required for replay determinism, probe P8)
  const id = evalId || ('eval-' + sha256(canonicalStringify({ name, effectMax: max, inputs: inputs.map(String) })).slice(0, 16));

  const normCanaries = (canaries || []).map((c) => {
    if (!c || typeof c.name !== 'string' || typeof c.value !== 'string') {
      throw new TypeError('each canary must be { name: string, value: string } - the raw value is hashed and never stored');
    }
    return { name: c.name, valueHash: sha256(c.value) };
  });

  const normInputs = (inputs || []).map((inp) => {
    const p = typeof inp === 'string' ? { path: inp } : inp;
    if (!p || typeof p.path !== 'string') throw new TypeError('each input must be a path string or { path }');
    const abs = path.resolve(p.path);
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error('envelope input is not a regular file: ' + abs);
    return { path: abs, sha256: sha256(fs.readFileSync(abs)) };
  });

  const envelope = {
    evalId: id,
    effectMax: max,
    canaries: normCanaries,
    inputs: normInputs,
    startedAt: now(),
  };

  return {
    evalId: envelope.evalId,
    effectMax: envelope.effectMax,
    canaries: envelope.canaries,
    inputs: envelope.inputs,
    startedAt: envelope.startedAt,

    /* gate every action against the declared maximum BEFORE it runs */
    authorize(effect) {
      const cls = normalizeEffect(effect);
      if (!effectAllowed(cls, max)) {
        throw new EnvelopeRefusedError(
          'REFUSED: action requires effect class ' + cls + ' (' + EFFECT_CLASSES[cls].name + ')' +
          ' but envelope effectMax is ' + max + ' (' + EFFECT_CLASSES[max].name + ')'
        );
      }
      return true;
    },

    findCanaryLeaks(input) {
      return findCanaryLeaks(input, normCanaries);
    },
  };
}

module.exports = { createEnvelope, EnvelopeRefusedError, CanaryLeakError, findCanaryLeaks, hashPresent };
