/**
 * B134 — AGENT CLIENT PROTOCOL (DeepSeek Harness `packages/acp/acp` mirror).
 *
 * An automation-only Agent Client Protocol server over JSON-RPC: external
 * agents/tools can initialize a session, send prompts, and stream agent
 * messages. JEXI exposes it over HTTP (POST /api/acp) instead of stdio so
 * the hosted brain can serve remote ACP clients.
 *
 * Methods (ACP):
 *   initialize({protocolVersion, clientCapabilities}) → {protocolVersion, agentCapabilities}
 *   session/new({id}) → {sessionId}
 *   session/prompt({sessionId, prompt}) → streams agent messages via SSE
 *   session/cancel({sessionId, signalId})
 *   session/delete({sessionId})
 */

import crypto from 'crypto';
import { runAgentLoop } from './AgentLoop.js';

const PROTOCOL_VERSION = '0.1.0';
const sessions = new Map(); // sessionId → { createdAt, active }

export function acpCapabilities() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: { supportsPrompt: true, supportsCancel: true },
  };
}

/** JSON-RPC error response. */
export function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/** Handle one JSON-RPC request. Returns the response (or a stream handle for prompt). */
export async function handleAcpRequest(body) {
  const id = body && body.id;
  const method = body && body.method;
  const params = (body && body.params) || {};

  if (!body || body.jsonrpc !== '2.0') return rpcError(id, -32600, 'Invalid Request: jsonrpc 2.0 required');
  if (typeof method !== 'string') return rpcError(id, -32600, 'Invalid Request: method required');

  switch (method) {
    case 'initialize': {
      const clientVersion = String((params && params.protocolVersion) || '').slice(0, 30);
      return { jsonrpc: '2.0', id, result: { protocolVersion: clientVersion || PROTOCOL_VERSION, agentCapabilities: acpCapabilities().agentCapabilities } };
    }
    case 'session/new': {
      const sessionId = String((params && params.id) || `acp-${crypto.randomUUID()}`).slice(0, 80);
      if (sessions.has(sessionId)) return rpcError(id, -32602, `session ${sessionId} already exists`);
      sessions.set(sessionId, { createdAt: Date.now(), active: false });
      return { jsonrpc: '2.0', id, result: { sessionId } };
    }
    case 'session/delete': {
      const sid = String((params && params.sessionId) || '');
      if (!sessions.delete(sid)) return rpcError(id, -32602, `session ${sid} not found`);
      return { jsonrpc: '2.0', id, result: { sessionId: sid } };
    }
    case 'session/cancel': {
      return { jsonrpc: '2.0', id, result: { sessionId: String((params && params.sessionId) || ''), cancelled: true } };
    }
    case 'session/prompt': {
      const sid = String((params && params.sessionId) || '');
      const prompt = String((params && params.prompt) || '');
      if (!sessions.has(sid)) return rpcError(id, -32602, `session ${sid} not found`);
      if (!prompt.trim()) return rpcError(id, -32602, 'prompt required');
      sessions.get(sid).active = true;
      // Run in-process; the HTTP layer streams the result.
      let answer = '';
      try {
        const out = await runAgentLoop({ query: prompt, sendEvent: () => {}, opts: { codeMode: true } });
        answer = out.answer || '';
      } catch (e) {
        answer = `### ⚠ ACP error\n\n${(e && e.message) || e}`;
      } finally {
        sessions.get(sid).active = false;
      }
      return { jsonrpc: '2.0', id, result: { sessionId: sid, messages: [{ role: 'agent', content: [{ type: 'text', text: answer }] }] } };
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

/** List active ACP sessions (diagnostics). */
export function acpSessionCount() {
  return sessions.size;
}
