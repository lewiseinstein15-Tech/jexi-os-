/**
 * M16 Phase 3 — a scripted, loopback OpenAI-compatible provider that speaks
 * Server-Sent Events (the shape JEXI's LLMClient uses when onToken is set).
 *
 * The REAL JEXI backend dials this exactly as it would dial Ollama. Each
 * scenario loads a queue of assistant rounds; the round is chosen by how many
 * tool results have been fed back, so a scenario is a plain ordered list.
 *
 * Control:
 *   POST /control/script  { rounds: [ {content, tool_calls?}, ... ] }
 *   POST /control/reset
 *   GET  /control/state   -> { served, queueLen, calls: [...] }
 */
import http from 'node:http';

export function startMockProvider() {
  let queue = [];
  let served = 0;
  const calls = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-llama', object: 'model' }] }));
      }
      if (req.method === 'POST' && req.url === '/control/script') {
        const parsed = JSON.parse(body || '{}');
        queue = Array.isArray(parsed.rounds) ? parsed.rounds.slice() : [];
        served = 0;
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, queued: queue.length }));
      }
      if (req.method === 'POST' && req.url === '/control/reset') {
        queue = []; served = 0; calls.length = 0;
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (req.method === 'GET' && req.url === '/control/state') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ served, queueLen: queue.length, calls }));
      }
      if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
        let reqJson = {};
        try { reqJson = JSON.parse(body || '{}'); } catch { /* keep empty */ }
        const msgs = Array.isArray(reqJson.messages) ? reqJson.messages : [];
        const k = msgs.filter((m) => m && m.role === 'tool').length;
        const round = queue.length ? queue[Math.min(k, queue.length - 1)] : { content: 'MOCK: no scripted round left.' };
        if (round.error) {
          served += 1;
          calls.push({ n: calls.length + 1, error: round.error, contentHead: '(provider error)' });
          res.writeHead(Number(round.error) || 500, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { message: `scripted provider failure (${round.error})` } }));
        }
        calls.push({
          n: calls.length + 1,
          toolNames: Array.isArray(round.tool_calls) ? round.tool_calls.map((t) => t.function && t.function.name) : [],
          contentHead: String(round.content || '').slice(0, 80),
        });
        served += 1;
        const message = { role: 'assistant', content: round.content || '' };
        if (Array.isArray(round.tool_calls) && round.tool_calls.length) {
          message.tool_calls = round.tool_calls.map((t, i) => ({
            id: t.id || `call_${served}_${i}`,
            type: 'function',
            function: { name: t.function.name, arguments: typeof t.function.arguments === 'string' ? t.function.arguments : JSON.stringify(t.function.arguments || {}) },
          }));
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        const send = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
        send({ id: "cmpl-" + served, object: "chat.completion.chunk", model: reqJson.model || "mock-llama", choices: [{ index: 0, delta: { role: "assistant", content: message.content || "" }, finish_reason: null }] });
        if (message.tool_calls) { send({ id: "cmpl-" + served, object: "chat.completion.chunk", model: reqJson.model || "mock-llama", choices: [{ index: 0, delta: { tool_calls: message.tool_calls.map((tc, i) => ({ index: i, id: tc.id, type: "function", function: tc.function })) }, finish_reason: null }] }); }
        send({ id: "cmpl-" + served, object: "chat.completion.chunk", model: reqJson.model || "mock-llama", choices: [{ index: 0, delta: {}, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] });
        res.end();
        return;
      }
      res.writeHead(404); res.end('{}');
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
