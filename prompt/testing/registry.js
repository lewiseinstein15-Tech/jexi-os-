// prompt/testing/registry.js
// Phase 25 — Scope K: the prompt test catalog.
//
// testing.register(testSpec) -> { testId }
//   testSpec = { id?, description, prompt, assertions: [...] }
//   - id (optional, non-empty string): explicit testId.
//   - description: required non-empty string (what the test guards).
//   - prompt: the built prompt string under test (required non-empty).
//   - assertions: required non-empty array of well-formed assertions
//     (validated AT REGISTRATION time with the same shape rules the
//     runner uses — a malformed assertion never enters the catalog).
//   testId: the spec's id, or 't-<12 hex>' derived from the spec content
//   when omitted. Registration with an EXISTING testId overwrites (the
//   catalog holds the latest spec for that id — deterministic last-write).
//
// Storage (RULE 6): .jexi/prompt-versions/tests/registry.json — real disk,
// under the same gitignored `.jexi/prompt-versions/` root as the snapshots.
// Same env override JEXI_PROMPT_VERSIONS_ROOT (read at CALL time) so probes
// get an isolated catalog per section. Deterministic: same specs -> same
// registry file (RULE 4).

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { versioningRoot, writeJsonAtomic } from '../versioning/snapshot.js';
import { assertAssertionShape, TESTING_CODES } from './assertions.js';

export { TESTING_CODES };

export function testsRoot() {
  return path.join(versioningRoot(), 'tests');
}

export function registryPath() {
  return path.join(testsRoot(), 'registry.json');
}

function readRegistry() {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath(), 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.tests && typeof parsed.tests === 'object') {
      return parsed;
    }
  } catch {
    // fall through: missing/corrupt registry = empty catalog
  }
  return { tests: {} };
}

/** Validate a test spec; returns { spec, testId } or { error, code }. */
function validateTestSpec(testSpec) {
  if (!testSpec || typeof testSpec !== 'object' || Array.isArray(testSpec)) {
    return { error: 'testSpec must be a plain object', code: TESTING_CODES.INVALID_TEST_SPEC };
  }
  if (typeof testSpec.description !== 'string' || testSpec.description.trim() === '') {
    return { error: 'testSpec.description must be a non-empty string', code: TESTING_CODES.INVALID_TEST_SPEC };
  }
  if (typeof testSpec.prompt !== 'string' || testSpec.prompt.trim() === '') {
    return { error: 'testSpec.prompt must be a non-empty string (the built prompt under test)', code: TESTING_CODES.INVALID_TEST_SPEC };
  }
  if (!Array.isArray(testSpec.assertions) || testSpec.assertions.length === 0) {
    return { error: 'testSpec.assertions must be a non-empty array', code: TESTING_CODES.INVALID_TEST_SPEC };
  }
  for (let i = 0; i < testSpec.assertions.length; i++) {
    const shapeErr = assertAssertionShape(testSpec.assertions[i]);
    if (shapeErr) {
      return {
        error: `testSpec.assertions[${i}]: ${shapeErr}`,
        code: TESTING_CODES.INVALID_ASSERTION,
      };
    }
  }
  if (testSpec.id !== undefined) {
    if (typeof testSpec.id !== 'string' || testSpec.id.trim() === '') {
      return { error: 'testSpec.id, when given, must be a non-empty string', code: TESTING_CODES.INVALID_TEST_SPEC };
    }
  }
  const spec = {
    description: testSpec.description,
    prompt: testSpec.prompt,
    assertions: testSpec.assertions.map((a) => JSON.parse(JSON.stringify(a))),
  };
  if (testSpec.id !== undefined) spec.id = testSpec.id.trim();
  const testId =
    spec.id ??
    `t-${createHash('sha256').update(JSON.stringify(spec), 'utf8').digest('hex').slice(0, 12)}`;
  return { spec, testId };
}

/**
 * testing.register(testSpec) -> { testId }
 * Deterministic: the same spec always maps to the same testId (explicit id,
 * or content hash); re-registration with the same id replaces that entry.
 */
export function register(testSpec) {
  const v = validateTestSpec(testSpec);
  if (v.error) {
    const err = new Error(`register refused: ${v.error}`);
    err.code = v.code;
    throw err;
  }
  const reg = readRegistry();
  reg.tests[v.testId] = { ...v.spec, testId: v.testId };
  writeJsonAtomic(registryPath(), reg);
  return { testId: v.testId };
}

/** testing.get(testId) -> spec (with testId) | null */
export function get(testId) {
  if (typeof testId !== 'string' || testId.trim() === '') return null;
  const reg = readRegistry();
  return reg.tests[testId.trim()] ?? null;
}

/** testing.list() -> [{ testId, description, assertions }] in catalog order. */
export function list() {
  const reg = readRegistry();
  return Object.entries(reg.tests).map(([testId, t]) => ({
    testId,
    description: t.description,
    assertions: t.assertions,
  }));
}
