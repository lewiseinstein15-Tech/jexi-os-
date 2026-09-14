import test from 'node:test';
import assert from 'node:assert/strict';
import { add } from './buggy.js';

test('add returns the real sum', () => {
  assert.equal(add(1, 2), 3);
});