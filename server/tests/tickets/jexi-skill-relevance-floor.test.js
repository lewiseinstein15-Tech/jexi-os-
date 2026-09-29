/**
 * Skills-library relevance floor.
 *
 * The matcher scored a single shared word in a skill's prose description at 2
 * points, and then added a +6 "prefer executable" bonus. Any question containing
 * a common word therefore matched some unrelated skill, and the keyless
 * fallback answered with that document verbatim — confidently, and wrongly.
 *
 * Observed live: "what makes a test suite trustworthy?" was answered with the
 * body of `conducting-wireless-network-penetration-test`, because that skill's
 * NAME ends in the word "test".
 *
 * A qualifying match must hit the name more than once, hit a short name, or be
 * the exact name. One stray generic segment in a long name proves nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findLibrarySkill } from '../../src/skills/library-registry.js';

/** The exact live failure. The name merely ENDS in "test". */
test('RELEVANCE: a generic word that is only a name suffix does not qualify', () => {
  const s = findLibrarySkill('what makes a test suite trustworthy?');
  assert.ok(s, 'a genuinely relevant skill may still match — TDD is on topic here');
  assert.notEqual(s.name, 'conducting-wireless-network-penetration-test',
    'an unrelated security skill must never answer a testing question');
  assert.match(s.name, /test|tdd|qa|quality/i,
    'whatever matches a test-quality question must be a testing skill');
});

test('RELEVANCE: an off-domain question matches nothing at all', () => {
  for (const q of ['what is the capital of France', 'tell me a joke', 'what time is it']) {
    assert.equal(findLibrarySkill(q), null, `"${q}" must not match a skill`);
  }
});

test('RELEVANCE: a real, on-topic query still resolves', () => {
  const cases = [
    ['how do I write a pre-commit hook', /pre-commit|git-hook/i],
    ['conducting wireless network penetration test', /wireless|penetration/i],
    ['nmap network scan', /nmap|network-scan/i],
    ['reverse engineer an iOS app with frida', /frida|reverse/i],
  ];
  for (const [q, want] of cases) {
    const s = findLibrarySkill(q);
    assert.ok(s, `"${q}" should still find its skill — the floor must not over-reject`);
    assert.match(s.name, want, `"${q}" matched the wrong skill: ${s.name}`);
  }
});

test('RELEVANCE: an empty or stopword-only query matches nothing', () => {
  assert.equal(findLibrarySkill(''), null);
  assert.equal(findLibrarySkill('   '), null);
  assert.equal(findLibrarySkill('the a an of to'), null);
});
