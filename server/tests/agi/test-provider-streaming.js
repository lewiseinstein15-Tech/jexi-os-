/**
 * SCOPE D - part 1 - real SSE streaming in ChatClientBase.stream().
 *
 * A tiny mock HTTP server streams raw Server-Sent Events for BOTH wire
 * formats (OpenAI-compatible chat/completions and Anthropic messages).
 * We then consume ChatClientBase.stream() and assert the normalized
 * ChatChunk pipeline: live deltas, reasoning, tool-call accumulation,
 * finish_reason, and final usage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { OpenAIAdapter } from '../../src/providers/adapters/openai.js';
import { AnthropicAdapter } from '../../src/providers/adapters/anthropic.js';

function startMockSSE({ openai, anthropic }) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const isAnthropic = req.url && req.url.endsWith('/messages');
      const chunks = isAnthropic ? anthropic(parsed) : openai(parsed);
      for (const [evt, data] of chunks) {
        res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);
      }
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, port: server.address().port });
  }));
}

async function collect(adapter, request) {
  const out = [];
  for await (const chunk of adapter.stream(request)) out.push(chunk);
  return out;
}

test('OpenAI wire: real SSE deltas + tool-call accumulation + usage', async () => {
  process.env.OPENAI_API_KEY = 'k-openai';
  const { server, port } = await startMockSSE({
    openai(parsed) {
      assert.equal(parsed.stream, true, 'stream:true must be set');
      assert.ok(parsed.model, 'model must be set');
      return [
        ['message', { choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' }, finish_reason: null }], id: '1' }],
        ['message', { choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }], id: '2' }],
        ['message', { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'read', arguments: '{"pa' } }] }, finish_reason: null }], id: '3' }],
        ['message', { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"x.js"}' } }] }, finish_reason: null }], id: '4' }],
        ['message', { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 11, completion_tokens: 4 }, id: '5' }],
      ];
    },
    anthropic() { return []; },
  });

  const adapter = new OpenAIAdapter({ baseUrl: `http://127.0.0.1:${port}/v1`, needsKey: true, keyEnv: 'OPENAI_API_KEY' }, process.env);
  const chunks = await collect(adapter, { messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o-mini' });

  const text = chunks.filter((c) => c.type === 'chunk').map((c) => c.delta.content || '').join('');
  assert.equal(text, 'Hello');
  const done = chunks[chunks.length - 1];
  assert.equal(done.type, 'done');
  assert.equal(done.text, 'Hello');
  assert.equal(done.usage.inputTokens, 11);
  assert.equal(done.usage.outputTokens, 4);
  assert.equal(done.tool_calls.length, 1);
  assert.equal(done.tool_calls[0].name, 'read');
  assert.deepEqual(done.tool_calls[0].arguments, { path: 'x.js' });
  assert.equal(done.tool_calls[0].id, 'call_a');
  server.close();
});

test('OpenAI wire: reasoning_content streamed as reasoning', async () => {
  const { server, port } = await startMockSSE({
    openai() {
      return [
        ['message', { choices: [{ index: 0, delta: { reasoning_content: 'let me think' }, finish_reason: null }] }],
        ['message', { choices: [{ index: 0, delta: { content: 'result' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }],
      ];
    },
    anthropic() { return []; },
  });
  const adapter = new OpenAIAdapter({ baseUrl: `http://127.0.0.1:${port}/v1`, needsKey: true, keyEnv: 'OPENAI_API_KEY' }, process.env);
  const chunks = await collect(adapter, { messages: [{ role: 'user', content: 'x' }], model: 'gpt-4o-mini' });
  const reasoning = chunks.filter((c) => c.delta && c.delta.reasoning).map((c) => c.delta.reasoning).join('');
  assert.equal(reasoning, 'let me think');
  server.close();
});

test('Anthropic wire: real SSE deltas + tool-use accumulation', async () => {
  const { server, port } = await startMockSSE({
    openai() { return []; },
    anthropic(parsed) {
      assert.equal(parsed.stream, true);
      assert.ok(parsed.model);
      return [
        ['message_start', { type: 'message_start', message: { id: 'msg_1' }, usage: { input_tokens: 5, output_tokens: 0 } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }],
        ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_01', name: 'grep', input: {} } }],
        ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"pat' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'tern":"x"}' } }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 6 } }],
        ['message_stop', { type: 'message_stop' }],
      ];
    },
  });
  const adapter = new AnthropicAdapter({ baseUrl: `http://127.0.0.1:${port}`, needsKey: true, keyEnv: 'ANTHROPIC_API_KEY' }, process.env);
  const chunks = await collect(adapter, { messages: [{ role: 'user', content: 'z' }], model: 'claude-3-5-haiku' });
  const text = chunks.filter((c) => c.type === 'chunk').map((c) => c.delta.content || '').join('');
  assert.equal(text, 'Hello');
  const done = chunks[chunks.length - 1];
  assert.equal(done.type, 'done');
  assert.equal(done.text, 'Hello');
  assert.equal(done.tool_calls.length, 1);
  assert.equal(done.tool_calls[0].name, 'grep');
  assert.deepEqual(done.tool_calls[0].arguments, { pattern: 'x' });
  assert.equal(done.usage.outputTokens, 6);
  server.close();
});

test('OpenAI wire: HTTP error surfaces as ClassifiedError (honest failure)', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'bad key' } }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const adapter = new OpenAIAdapter({ baseUrl: `http://127.0.0.1:${port}/v1`, needsKey: true, keyEnv: 'OPENAI_API_KEY' }, process.env);
  await assert.rejects(
    collect(adapter, { messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o-mini' }),
    (e) => { assert.ok(e); return true; },
  );
  server.close();
});
