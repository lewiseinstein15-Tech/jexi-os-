'use strict';

/*
 * verification/eval/capsule.js
 * Append-only NDJSON event log with sha256 predecessor links.
 *
 * One line per event:
 *   { seq, prevHash, type: 'start'|'tool'|'result'|'end', payload, hash }
 *
 * hash     = sha256(seq + '|' + prevHash + '|' + type + '|' + canonicalJson(payload))
 * prevHash = hash of the previous line (null for seq 0)
 *
 * The chain is verifiable: recompute each hash from its own fields
 * (seq + prevHash + type + payload). Any tampering breaks the chain at
 * a specific, reportable seq (probe P3).
 *
 * The capsule carries NO wall-clock data - replay determinism
 * (same inputs -> same capsule root, probe P8) depends on it. The
 * envelope (which holds startedAt) is deliberately kept OUT of the chain.
 */

const { sha256, canonicalStringify } = require('./rules');

const EVENT_TYPES = Object.freeze(['start', 'tool', 'result', 'end']);

function eventHash(ev) {
  const prev = ev.prevHash === null || ev.prevHash === undefined ? 'null' : ev.prevHash;
  const payload = ev.payload === undefined ? null : ev.payload;
  return sha256(String(ev.seq) + '|' + prev + '|' + ev.type + '|' + canonicalStringify(payload));
}

class Capsule {
  constructor() {
    this.events = [];
  }

  append(type, payload) {
    if (!EVENT_TYPES.includes(type)) {
      throw new Error('invalid capsule event type: ' + type + ' (expected ' + EVENT_TYPES.join('|') + ')');
    }
    if (type === 'start' && this.events.length > 0) {
      throw new Error('capsule: start must be the first event');
    }
    if (type !== 'start' && this.events.length === 0) {
      throw new Error('capsule: first event must be start');
    }
    if (this.events.length > 0 && this.events[this.events.length - 1].type === 'end') {
      throw new Error('capsule: append after end is not allowed (capsule is sealed)');
    }
    const seq = this.events.length;
    const prevHash = seq === 0 ? null : this.events[seq - 1].hash;
    const event = { seq, prevHash, type, payload, hash: eventHash({ seq, prevHash, type, payload }) };
    this.events.push(event);
    return event;
  }

  get lastHash() {
    return this.events.length ? this.events[this.events.length - 1].hash : null;
  }

  /*
   * capsuleRoot = sha256 of the final capsule hash (receipt contract).
   * Deterministic for identical event chains.
   */
  root() {
    if (!this.events.length) throw new Error('capsule: root of empty capsule is undefined');
    return sha256(this.lastHash);
  }

  toNDJSON() {
    return this.events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  }

  static fromNDJSON(text) {
    const cap = new Capsule();
    cap.events = String(text)
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((line) => {
        const raw = JSON.parse(line); // throws on structurally corrupt lines
        return {
          seq: raw.seq,
          prevHash: raw.prevHash === undefined ? null : raw.prevHash,
          type: raw.type,
          payload: raw.payload,
          hash: raw.hash,
        };
      });
    return cap;
  }

  /*
   * Verifier: recompute every hash from seq + prevHash + type + payload,
   * check the prevHash links and the seq numbering. Returns per-event
   * detail; on the first break returns { ok: false, brokenAt, reason }.
   */
  verify() {
    const checked = [];
    let prevHash = null;
    for (let i = 0; i < this.events.length; i++) {
      const ev = this.events[i];
      const problems = [];
      const storedPrev = ev.prevHash === undefined ? null : ev.prevHash;
      if (ev.seq !== i) {
        problems.push('seq mismatch: stored ' + ev.seq + ', expected ' + i);
      }
      if (storedPrev !== prevHash) {
        problems.push('prevHash link broken: stored ' + JSON.stringify(storedPrev) + ', expected ' + JSON.stringify(prevHash));
      }
      const recomputed = eventHash(ev);
      if (recomputed !== ev.hash) {
        problems.push('hash mismatch: recomputed ' + String(recomputed).slice(0, 16) + '..., stored ' + String(ev.hash === undefined ? 'null' : ev.hash).slice(0, 16) + '...');
      }
      checked.push({ seq: ev.seq === undefined ? i : ev.seq, ok: problems.length === 0, problems });
      if (problems.length) {
        return { ok: false, brokenAt: i, reason: problems.join('; '), checked };
      }
      prevHash = ev.hash;
    }
    return {
      ok: true,
      events: this.events.length,
      root: this.events.length ? this.root() : null,
      checked,
    };
  }
}

module.exports = { Capsule, eventHash, EVENT_TYPES };
