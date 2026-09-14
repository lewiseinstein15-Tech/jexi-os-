import test from 'node:test';
import assert from 'node:assert/strict';
import { add } from './add.js';

test('add returns the sum', () => {
  assert.equal(add(1, 2), 3);
});