'use strict';

/*
 * verification/eval/index.js - facade for the JEXI OS eval harness.
 * Phase 7 Scope E - follows the ECC eval-harness reference.
 *
 *   const ev = require('../verification/eval');
 *
 *   ev.createEnvelope({ name, effectMax: 'SE1', canaries: [...], inputs: [...] })
 *   ev.Capsule                       - append-only NDJSON sha256 chain
 *   ev.ReplayRunner                  - effect-fenced execution / replay
 *   ev.runGate(files)                - source digests + syntactic warnings
 *   ev.issueReceipt / ev.verifyReceipt - offline-verifiable receipts
 *   ev.EvalHarness                   - glue: envelope + capsule + runner
 */

const { createEnvelope, EnvelopeRefusedError, CanaryLeakError } = require('./envelope');
const { Capsule, eventHash, EVENT_TYPES } = require('./capsule');
const { runGate, gateSource, DANGEROUS_CALLS, UNICODE_TRICKS } = require('./gate');
const { ReplayRunner, ReplayRefusedError, FixtureMissingError, performIO } = require('./replay');
const { issueReceipt, verifyReceipt, loadReceiptKey, artifactDigestOf } = require('./receipt');
const {
  sha256, canonicalStringify, EFFECT_CLASSES, normalizeEffect, effectLevel,
  effectAllowed, inferEffect, redact, REDACTION_PATTERNS,
} = require('./rules');

/*
 * EvalHarness - one declared eval run:
 *   const h = new ev.EvalHarness({ name: 'my-eval', effectMax: 'SE1', inputs: ['package.json'] });
 *   const out = h.io('readFile', { path: 'package.json' });
 *   h.result({ bytes: out.bytes });
 *   const fin = h.finish();  // canary check over capsule + artifact + stderr
 *
 * The capsule 'start' event carries NO wall-clock data - replay
 * determinism (same inputs -> same capsule root) requires it.
 * startedAt lives only in the envelope, which is not part of the chain.
 */
class EvalHarness {
  constructor({ name = 'eval', evalId = null, effectMax, canaries = [], inputs = [], mode = 'record', allowSe3Plus = false, fixturesFile = null } = {}) {
    this.envelope = createEnvelope({ name, evalId, effectMax, canaries, inputs });
    this.capsule = new Capsule();
    this.runner = new ReplayRunner({
      envelope: this.envelope,
      capsule: this.capsule,
      mode,
      allowSe3Plus,
      fixtures: fixturesFile ? ReplayRunner.loadFixtures(fixturesFile) : null,
    });
    this.resultPayloads = [];
    this.artifact = null;
    this.stderr = '';
    this.capsule.append('start', {
      evalId: this.envelope.evalId,
      effectMax: this.envelope.effectMax,
      inputs: this.envelope.inputs,
    });
  }

  io(tool, args, effectHint) {
    return this.runner.io(tool, args, effectHint);
  }

  result(payload) {
    this.resultPayloads.push(payload);
    this.capsule.append('result', payload);
    this.artifact = canonicalStringify(this.resultPayloads);
    return payload;
  }

  setArtifact(a) { this.artifact = a; return a; }
  setStderr(s) { this.stderr = String(s == null ? '' : s); return this.stderr; }

  /*
   * STEP 2 contract: if a canary value appears in the eval output
   * (capsule, artifact, or stderr) the envelope FAILS. Detection is
   * hash-compare over every string, line, token and sliding window.
   */
  finish() {
    const findings = [];
    const scan = (where, input) => {
      for (const name of this.envelope.findCanaryLeaks(input)) findings.push(where + ':' + name);
    };
    scan('capsule', this.capsule.events);
    scan('capsule', this.capsule.toNDJSON());
    if (this.artifact !== null) scan('artifact', String(this.artifact));
    scan('stderr', this.stderr);
    if (findings.length) {
      throw new CanaryLeakError('canary leaked: ' + Array.from(new Set(findings)).join(', ') + ' - envelope FAILS');
    }
    this.capsule.append('end', { ok: true, events: this.capsule.events.length + 1 });
    return {
      evalId: this.envelope.evalId,
      effectMax: this.envelope.effectMax,
      capsuleRoot: this.capsule.root(),
      events: this.capsule.events.length,
      ok: true,
    };
  }
}

module.exports = {
  // envelope
  createEnvelope,
  EnvelopeRefusedError,
  CanaryLeakError,
  // capsule
  Capsule,
  eventHash,
  EVENT_TYPES,
  // gate
  runGate,
  gateSource,
  DANGEROUS_CALLS,
  UNICODE_TRICKS,
  // replay
  ReplayRunner,
  ReplayRefusedError,
  FixtureMissingError,
  performIO,
  // receipt
  issueReceipt,
  verifyReceipt,
  loadReceiptKey,
  artifactDigestOf,
  // glue
  EvalHarness,
  // rules
  sha256,
  canonicalStringify,
  EFFECT_CLASSES,
  normalizeEffect,
  effectLevel,
  effectAllowed,
  inferEffect,
  redact,
  REDACTION_PATTERNS,
};
