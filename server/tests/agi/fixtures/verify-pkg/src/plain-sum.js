// A plain assertion script (NOT node:test) — exits nonzero on failure so the
// verifier's real-spawn path sees a genuine failing test run even when invoked
// as a child process inside the parent node --test harness.
import assert from 'node:assert/strict';
import { add } from './add.js';

assert.equal(add(1, 2), 3);
console.log('plainsum: ok');