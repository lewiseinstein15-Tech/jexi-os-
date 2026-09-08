/**
 * test-mcp-arg-alias — gateway fills missing REQUIRED MCP args from aliases.
 *
 * Proves the free-search:research fix: the live schema requires `question`,
 * models send `query` — the gateway now maps it before the call instead of
 * letting the server reject with pydantic validation errors. Only
 * declared-required fields are ever filled, only with type-fitting values.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMcpArgAliases } from './src/services/MCPGateway.js';

const researchDef = {
  name: 'research',
  inputSchema: {
    type: 'object',
    properties: { question: { type: 'string' }, freshness: { type: 'string', enum: ['day', 'week', 'month', 'year'] }, max_results: { type: 'number' } },
    required: ['question'],
  },
};

test('query is aliased to missing required question (the live failure)', () => {
  const out = applyMcpArgAliases(researchDef, { query: 'current stable Node.js version' });
  assert.equal(out.question, 'current stable Node.js version');
  assert.equal(out.query, 'current stable Node.js version'); // original kept
});

test('a present question is never overwritten', () => {
  const out = applyMcpArgAliases(researchDef, { question: 'a', query: 'b' });
  assert.equal(out, out); // same run, no crash
  assert.equal(out.question, 'a');
});

test('nothing to fill returns the identical object (no copy churn)', () => {
  const args = { question: 'a' };
  assert.equal(applyMcpArgAliases(researchDef, args), args);
  assert.equal(applyMcpArgAliases({ name: 'x' }, args), args); // no schema
  assert.equal(applyMcpArgAliases(researchDef, null), null);
});

test('type mismatches are not copied', () => {
  const out = applyMcpArgAliases(researchDef, { query: { not: 'a string' } });
  assert.equal(out.question, undefined);
});

test('symmetric: question fills a required query field', () => {
  const def = { name: 'search', inputSchema: { properties: { query: { type: 'string' } }, required: ['query'] } };
  assert.equal(applyMcpArgAliases(def, { question: 'q' }).query, 'q');
});

test('enum-violating values are pruned so the server default applies (live freshness failure)', () => {
  const out = applyMcpArgAliases(researchDef, { question: 'x', freshness: 'recent' });
  assert.equal(out.question, 'x');
  assert.equal(out.freshness, undefined);
});

test('valid enum values pass through with the identical object', () => {
  const args = { question: 'x', freshness: 'week' };
  assert.equal(applyMcpArgAliases(researchDef, args), args);
});

test('non-required fields are never invented', () => {
  const out = applyMcpArgAliases(researchDef, { query: 'q', max_results: 5 });
  assert.equal(out.max_results, 5);
  assert.deepEqual(Object.keys(out).sort(), ['max_results', 'query', 'question']);
});
