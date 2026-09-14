/**
 * JEXI OS — tools — memory domain.
 *
 * store / recall / forget — MemoryProvider backends are injected (Phase 3
 * segment), definitions registered now for API stability.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import { openMemorySystem } from '../../../memory/index.js';
import fs from 'node:fs';
import path from 'node:path';

// One shared SQLite file per process (lazy-opened). Semantics: a fact stored
// under a mission scoped by ctx.missionId (default 'tools') is persisted to
// disk and survives a process restart — reopening the same file re-loads it.
let _mem = null;
let _memFile = null;

async function memFor(ctx = {}) {
  const file = ctx.memoryFile ?? process.env.JEXI_TOOLS_MEMORY_FILE ?? path.join(ctx.root ?? process.cwd(), '.jexi', 'tools-memory.db');
  if (_mem && _memFile === file) return _mem;
  if (_mem) { try { await _mem.shutdown(); } catch {} _mem = null; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  _mem = await openMemorySystem({ file });
  _memFile = file;
  return _mem;
}

export function registerMemTools() {
  const store = defineTool({
    name: 'mem_store', description: 'Persist a fact under a key.', riskLevel: 'medium', runtimeRing: 1,
    parameters: { type: 'object', properties: { key: { type: 'string' }, value: {} }, required: ['key', 'value'] },
    sideEffects: ['write'], idempotent: true,
  });
  const recall = defineTool({
    name: 'mem_recall', description: 'Recall a fact by key or prefix.', riskLevel: 'low', runtimeRing: 1, idempotent: true,
    parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  });
  const forget = defineTool({
    name: 'mem_forget', description: 'Delete a stored fact.', riskLevel: 'critical', runtimeRing: 1,
    parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    sideEffects: ['delete'], idempotent: true,
  });
  const unreg = registerToolBatch([store, recall, forget]);

  const engines = {
    async mem_store({ key, value }, ctx = {}) {
      const missionId = ctx.missionId ?? 'tools';
      const mem = await memFor(ctx);
      const content = (value && typeof value === 'object') ? JSON.stringify(value) : String(value ?? '');
      await mem.layers.session.write({ missionId, content, metadata: { kind: 'tool-fact', key } });
      return { ok: true, storedKey: key, value, missionId };
    },
    async mem_recall({ key }, ctx = {}) {
      const missionId = ctx.missionId ?? 'tools';
      const mem = await memFor(ctx);
      const rows = await mem.layers.session.list({ missionId });
      const hit = rows.find((r) => r.metadata?.kind === 'tool-fact' && r.metadata?.key === key);
      if (!hit) return { ok: false, found: false, key, missionId };
      let value = hit.content;
      try { value = JSON.parse(hit.content); } catch { /* keep string */ }
      return { ok: true, key, value, missionId };
    },
    async mem_forget({ key }, ctx = {}) {
      const missionId = ctx.missionId ?? 'tools';
      const mem = await memFor(ctx);
      const rows = await mem.layers.session.list({ missionId });
      const hit = rows.find((r) => r.metadata?.kind === 'tool-fact' && r.metadata?.key === key);
      if (hit) await mem.backend.deleteByKey(hit.id);
      return { ok: true, forgotKey: key, missionId };
    },
  };
  return { unreg, engines };
}