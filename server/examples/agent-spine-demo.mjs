#!/usr/bin/env node
/**
 * B139 — AGENT SPINE DEMO (dsh examples/agent-spine-demo mirror, JEXI-branded).
 * One full agent turn through the SAME pipeline the web app uses: Planner
 * routing → gated tool calls → final answer. Runs offline (no API keys
 * needed for the plumbing itself; the LLM step needs provider keys).
 *
 *   node examples/agent-spine-demo.mjs "what time is it in Nairobi?"
 */
import { runAgentLoop } from '../src/services/AgentLoop.js';

const query = process.argv.slice(2).join(' ') || 'What is the capital of Kenya?';
const events = [];
const res = await runAgentLoop({
  query,
  sendEvent: (type, data) => events.push({ type, ...data }),
  opts: { convId: `demo-spine-${Date.now()}` },
});

console.log(JSON.stringify({
  query,
  answer: res.answer,
  stats: res.stats,
  events: events.slice(-8).map((e) => ({ type: e.type, message: e.message || e.preview || '' })),
}, null, 2));
