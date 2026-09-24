'use strict';

/*
 * verification/eval/replay.js
 *
 * Effect-fenced execution + replay with content-addressed fixtures.
 *
 * - every IO goes through runner.io(tool, args[, effectHint])
 * - the effect class is max(inferred, hinted) - a step can never
 *   downgrade-smuggle an SE3 action behind an SE1 hint
 * - the envelope gate runs FIRST: an action above envelope.effectMax
 *   is refused before anything happens (probe P4)
 * - the replay fence: SE3+ is refused without an explicit override
 *   (allowSe3Plus: true, default false)
 * - fixture key = sha256(canonicalJson({ tool, args }))  (content-addressed)
 * - record mode: performs allowed IO and records fixtures
 * - replay mode: performs NO real IO - SE0 recomputes (pure), SE1
 *   must come from a recorded fixture, SE2+ steps are stubbed by default
 * - deterministic: same inputs -> same capsule root (probe P8)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  sha256, canonicalStringify, normalizeEffect, effectLevel, inferEffect, EFFECT_CLASSES,
} = require('./rules');

class ReplayRefusedError extends Error {
  constructor(msg) { super(msg); this.name = 'ReplayRefusedError'; }
}

class FixtureMissingError extends Error {
  constructor(msg) { super(msg); this.name = 'FixtureMissingError'; }
}

/* CLOSED switch: the only IO executor the harness has. */
function performIO(tool, args) {
  switch (tool) {
    case 'compute': {
      return { sum: Number(args.a) + Number(args.b) };
    }
    case 'readFile': {
      const abs = path.resolve(String(args.path));
      const content = fs.readFileSync(abs, 'utf8');
      return { content, sha256: sha256(content), bytes: Buffer.byteLength(content) };
    }
    case 'stat': {
      const abs = path.resolve(String(args.path));
      const st = fs.statSync(abs);
      return { size: st.size, isFile: st.isFile() }; // no wall-clock fields
    }
    case 'writeFile': {
      const abs = path.resolve(String(args.path));
      fs.writeFileSync(abs, String(args.data));
      return { written: abs, bytes: Buffer.byteLength(String(args.data)) };
    }
    case 'exec': {
      const out = execFileSync(String(args.cmd), (args.args || []).map(String), {
        encoding: 'utf8',
        cwd: args.cwd ? path.resolve(args.cwd) : undefined,
      });
      return { stdout: String(out) };
    }
    default:
      throw new Error('unknown tool: ' + tool);
  }
}

class ReplayRunner {
  constructor({ envelope, capsule, fixtures = null, mode = 'record', allowSe3Plus = false } = {}) {
    if (!envelope) throw new TypeError('ReplayRunner requires an envelope');
    if (!capsule) throw new TypeError('ReplayRunner requires a capsule');
    this.envelope = envelope;
    this.capsule = capsule;
    this.mode = mode === 'replay' ? 'replay' : 'record';
    this.allowSe3Plus = allowSe3Plus === true; // explicit override ONLY
    this.fixtures = new Map();
    if (fixtures) for (const f of fixtures) this.fixtures.set(f.key, f);
  }

  fixtureKey(tool, args) {
    return sha256(canonicalStringify({ tool, args: args || {} }));
  }

  io(tool, args, effectHint) {
    const inferred = inferEffect(tool, args);
    let effect = effectHint ? normalizeEffect(effectHint) : inferred;
    if (effectLevel(inferred) > effectLevel(effect)) effect = inferred; // no downgrade smuggling

    // 1) envelope gate - refused BEFORE anything runs (probe P4)
    this.envelope.authorize(effect);

    // 2) replay fence - SE3+ refused without explicit override
    if (effectLevel(effect) >= 3 && !this.allowSe3Plus) {
      throw new ReplayRefusedError(
        'REFUSED: replay fence blocks ' + effect + ' (' + EFFECT_CLASSES[effect].name + ')' +
        " for tool '" + tool + "' - explicit override required"
      );
    }

    // 3) content-addressed fixture lookup (keyed by sha256 of the input)
    const key = this.fixtureKey(tool, args);
    const fixture = this.fixtures.get(key);
    if (fixture) {
      this.capsule.append('tool', { tool, key, effect, output: fixture.output });
      return fixture.output;
    }

    if (this.mode === 'replay') {
      // replay mode performs NO real IO
      if (effectLevel(effect) >= 2) {
        // SE2+ steps are stubbed by default
        const stub = {
          stubbed: true,
          tool,
          effect,
          reason: 'SE2+ stubbed in replay mode (no fixture ' + key.slice(0, 12) + '...)',
        };
        this.capsule.append('tool', { tool, key, effect, output: stub });
        return stub;
      }
      if (effectLevel(effect) >= 1) {
        throw new FixtureMissingError(
          "fixture missing for " + effect + " tool '" + tool + "' key=" + key +
          ' - replay mode never performs real IO'
        );
      }
      // SE0: pure - safe to recompute
    }

    // 4) record mode (or pure SE0): perform the allowed IO, record the fixture
    const output = performIO(tool, args);
    this.fixtures.set(key, { key, tool, effect, output });
    this.capsule.append('tool', { tool, key, effect, output });
    return output;
  }

  fixturesNDJSON() {
    let out = '';
    for (const f of this.fixtures.values()) out += JSON.stringify(f) + '\n';
    return out;
  }

  saveFixtures(file) {
    fs.writeFileSync(file, this.fixturesNDJSON());
    return file;
  }

  static loadFixtures(file) {
    if (!fs.existsSync(file)) return [];
    return String(fs.readFileSync(file, 'utf8'))
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
  }
}

module.exports = { ReplayRunner, ReplayRefusedError, FixtureMissingError, performIO };
