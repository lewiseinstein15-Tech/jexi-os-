/**
 * B132 — SESSION TELEMETRY (DeepSeek Harness `packages/session/session-telemetry` mirror).
 *
 * Durable, append-only telemetry per chat turn: latency, intent, outcome,
 * tool calls, provider, message counts. No prompts, no keys, no PII — the
 * data is safe to expose read-only. Bounded to the last 2000 events.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { writeFileAtomic } from './AtomicWrite.js';

const TELEMETRY_FILE = path.join(DATA_DIR, 'telemetry.jsonl');
const MAX_EVENTS = 2000;

/** Record one chat-turn telemetry event (never throws). */
export function recordTelemetry(event = {}) {
  try {
    const clean = {
      at: Date.now(),
      latencyMs: Number(event.latencyMs) || 0,
      intent: String(event.intent || 'unknown').slice(0, 40),
      ok: event.ok !== false,
      complexity: String(event.complexity || '').slice(0, 20),
      toolCalls: Number(event.toolCalls) || 0,
      providers: Array.isArray(event.providers) ? event.providers.slice(0, 5).map((p) => String(p).slice(0, 30)) : [],
      sourceCount: Number(event.sourceCount) || 0,
      fileCount: Number(event.fileCount) || 0,
      approxTokens: Number(event.approxTokens) || 0,
    };
    fs.appendFileSync(TELEMETRY_FILE, JSON.stringify(clean) + '\n', 'utf-8');
    // Cap every 64 events.
    if (clean.at % 64 < 2) {
      try {
        const lines = fs.readFileSync(TELEMETRY_FILE, 'utf-8').split('\n').filter(Boolean);
        if (lines.length > MAX_EVENTS) writeFileAtomic(TELEMETRY_FILE, lines.slice(lines.length - MAX_EVENTS).join('\n') + '\n');
      } catch { /* noop */ }
    }
  } catch { /* telemetry must never break chat */ }
}

/** Read-only telemetry (no secrets). */
export function readTelemetry(limit = 200) {
  try {
    if (!fs.existsSync(TELEMETRY_FILE)) return [];
    const lines = fs.readFileSync(TELEMETRY_FILE, 'utf-8').split('\n').filter(Boolean);
    const out = [];
    for (const l of lines.slice(-Math.max(1, Number(limit) || 200))) {
      try { out.push(JSON.parse(l)); } catch { /* skip corrupt */ }
    }
    return out;
  } catch { return []; }
}

/** Aggregates for diagnostics (latency, success rate, tool usage). */
export function telemetryStats(limit = 500) {
  const evs = readTelemetry(limit);
  if (!evs.length) return { total: 0 };
  const latencies = evs.map((e) => e.latencyMs || 0);
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  const byIntent = {};
  for (const e of evs) byIntent[e.intent] = (byIntent[e.intent] || 0) + 1;
  return {
    total: evs.length,
    avgLatencyMs: avg(latencies),
    p95LatencyMs: latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)] || 0,
    successRate: Math.round((evs.filter((e) => e.ok).length / evs.length) * 100),
    avgToolCalls: Math.round(avg(evs.map((e) => e.toolCalls || 0)) * 10) / 10,
    byIntent: Object.entries(byIntent).sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}
