# JEXI OS — Examples (DeepSeek Harness `packages/examples` mirror)

Working examples of the JEXI surfaces, JEXI-branded. Each example runs
against the real server (`server/index.js`) or the headless CLI
(`server/cli.js`) — nothing here is mockup-only.

## 1. Headless one-shot (dsh `bundle/headless` analog)

```bash
cd server
node cli.js "what time is it in Nairobi?"
node cli.js --json "summarize the last conversation" --conv <convId>
node cli.js --self-test
```

## 2. JSON-RPC demo (dsh `examples/jsonrpc-demo`)

The server speaks JSON-RPC 2.0 over HTTP at `/api/acp` (the ACP port) and
over the streamable MCP endpoint at `/mcp`.

```bash
curl -s -X POST http://localhost:3002/api/acp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## 3. Agent spine demo (dsh `examples/agent-spine-demo`)

A full agent turn through the same pipeline the web app uses: Planner
routing → gated tool calls → final answer.

```js
// server/examples/agent-spine-demo.mjs
import { runAgentLoop } from '../src/services/AgentLoop.js';

const events = [];
const res = await runAgentLoop({
  query: 'What is the capital of Kenya?',
  sendEvent: (type, data) => events.push({ type, ...data }),
  opts: { convId: 'demo-spine' },
});
console.log(JSON.stringify({ answer: res.answer, events: events.slice(-5) }, null, 2));
```

## 4. ACP demo (dsh `examples/acp-demo`)

```bash
# initialize + list tools over the ACP JSON-RPC surface
curl -s -X POST http://localhost:3002/api/acp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"0.1.0","capabilities":{},"clientInfo":{"name":"demo","version":"1.0.0"}}}'
```

## 5. Permission presets + personas (dsh `interaction` + `preset` mirrors)

```bash
# read the session's permission fold (sandbox mode + approval policy + preset)
curl -s "http://localhost:3002/api/permissions?conv=demo"
# switch a conversation to the autonomous preset (never pauses for approval)
curl -s -X POST http://localhost:3002/api/permissions \
  -H 'Content-Type: application/json' -d '{"conv":"demo","preset":"autonomous"}'
# list personas and pick one per request
curl -s http://localhost:3002/api/personas
curl -s -X POST http://localhost:3002/api/chat -H 'x-jexi-persona: concise' -d '{"query":"hi"}'
```

> Note: the live backend is key-locked — add `-H 'x-jexi-key: <your key>'` when
> talking to `https://jexi-brain-image.onrender.com`.
