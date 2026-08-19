/**
 * B141 — LLM MOCK SERVER (DeepSeek Harness
 * `packages/test-support/llm-mock-server` mirror, JEXI-branded).
 *
 * An HTTP mock LLM server for tests: listens on a port and answers
 * OpenAI-style /v1/chat/completions and /v1/generate (Gemini-ish) requests
 * from a script of canned responses, recording every call. Deterministic,
 * offline, zero keys.
 *
 *   const mock = await startMockLlm({ script: [{ match: /weather/, content: 'sunny' }] });
 *   const reply = await fetch(`${mock.url}/v1/chat/completions`, {...});
 *   mock.calls; mock.close();
 */

import http from 'http';
import { createReplayProvider } from './llm-replay.js';

export function parseMockLlmCliArgs(argv = []) {
  const out = { port: null, scriptFile: null, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port' && argv[i + 1]) { out.port = Number(argv[i + 1]); i += 1; }
    else if (argv[i] === '--script' && argv[i + 1]) { out.scriptFile = argv[i + 1]; i += 1; }
    else if (argv[i] === '--host' && argv[i + 1]) { out.host = argv[i + 1]; i += 1; }
    else if (argv[i] === '--help' || argv[i] === '-h') { out.help = true; }
  }
  return out;
}

/** Start the mock LLM server. */
export async function startMockLlm({ script = [], mode = 'match', port = 0, host = '127.0.0.1' } = {}) {
  const provider = createReplayProvider({ script, mode });
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    let reqBody = {};
    try { reqBody = JSON.parse(body || '{}'); } catch { reqBody = { raw: body }; }
    const url = new URL(req.url, `http://${host}`);
    let status = 200;
    let payload = null;
    try {
      if (url.pathname === '/v1/chat/completions') {
        const prompt = (reqBody.messages || []).map((m) => m.content || '').join('\n');
        const content = await provider.chatWithToolsOnce(prompt, '', []);
        const text = typeof content.content === 'string' ? content.content : JSON.stringify(content.content);
        payload = { id: 'mock-chat', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
      } else if (url.pathname === '/v1/generate') {
        const content = await provider.generateContent(String(reqBody.prompt || ''), '', null, {});
        payload = { candidates: [{ content: { parts: [{ text: content }] } }] };
      } else {
        status = 404;
        payload = { error: { message: `unknown path ${url.pathname}` } };
      }
    } catch (e) {
      status = 500;
      payload = { error: { message: (e && e.message) || 'mock failure' } };
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
    provider.calls.push({ path: url.pathname, body: reqBody, at: Date.now() });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    calls: provider.calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** CLI entry (bin parity). */
export async function main(argv = process.argv.slice(2)) {
  const args = parseMockLlmCliArgs(argv);
  if (args.help) {
    console.log('jexi llm-mock-server: --port N --script file.json [--host H]');
    process.exit(0);
  }
  let script = [];
  if (args.scriptFile) {
    const fs = await import('fs');
    script = JSON.parse(fs.readFileSync(args.scriptFile, 'utf-8'));
  }
  const mock = await startMockLlm({ script, port: args.port || 0, host: args.host });
  console.log(`jexi llm-mock-server listening on ${mock.url}`);
  return mock;
}
