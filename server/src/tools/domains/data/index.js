/**
 * JEXI OS — tools — data domain.
 *
 * json, csv, sql. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import fs from 'node:fs';
import path from 'node:path';
import { loadSqliteModule } from '../../../services/StorageHub.js';

/** jq-like dot-path query: 'a.b', 'a[0].c', '*' returns the value. */
function queryPath(obj, pathStr) {
  const parts = String(pathStr || '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((x) => x !== '')) rows.push(row); }
  if (!rows.length) return { rows: [], columns: [] };
  const columns = rows[0];
  const data = rows.slice(1).map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
  return { columns, rows: data };
}

export function registerDataTools() {
  const defs = [
    defineTool({ name: 'data_json', description: 'Parse JSON and run a jq-like dot-path query.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { text: { type: 'string' }, path: { type: 'string' } }, required: ['text'] }, sideEffects: ['data'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'data_csv', description: 'Parse CSV text into rows.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, sideEffects: ['data'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'data_sql', description: 'Run a SQL query against a SQLite file.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { file: { type: 'string' }, sql: { type: 'string' } }, required: ['file', 'sql'] }, sideEffects: ['data'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    async data_json({ text, path: p }, _ctx = {}) {
      let parsed;
      try { parsed = JSON.parse(String(text ?? '')); }
      catch (e) { return { ok: false, error: `invalid JSON: ${(e && e.message) || e}` }; }
      const value = p ? queryPath(parsed, p) : parsed;
      return { ok: true, value, path: p ?? null };
    },
    async data_csv({ text }, _ctx = {}) {
      return { ok: true, ...parseCsv(text) };
    },
    async data_sql({ file, sql }, _ctx = {}) {
      const mod = await loadSqliteModule();
      if (!mod?.DatabaseSync) return { ok: false, error: 'node:sqlite unavailable on this Node runtime' };
      let db;
      try {
        db = new mod.DatabaseSync(String(file ?? ''), { readOnly: false });
        const rows = db.prepare(String(sql ?? '')).all();
        return { ok: true, rows, count: rows.length };
      } catch (e) {
        return { ok: false, error: `sql failed: ${(e && e.message) || e}` };
      } finally {
        try { db?.close(); } catch { /* noop */ }
      }
    },
  };
  return { unreg, engines };
}
