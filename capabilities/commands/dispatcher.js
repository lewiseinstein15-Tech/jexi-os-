/**
 * JEXI OS — COMMANDS — dispatcher (Phase 7 G).
 *
 * Parse → resolve aliases → validate args → run handler with ctx → emit.
 *
 *   input:   /<name> arg1 arg2 --flag value
 *   ctx:     { session, agent, hud, log, verify }
 *   emits:   command.executed  (bus, when the command starts)
 *            command.completed (bus, on ok)
 *            command.failed    (bus, on error)
 *
 * The bus is the server's Observer (dual-depth, fail-soft: standalone probe
 * runs without a server simply skip the emit). The HUD is notified through
 * its public schedulePublish() so open commands show up as a revision bump
 * on /api/hud and the SSE stream — without the dispatcher ever reaching into
 * HUD internals.
 *
 * dispatch() NEVER THROWS — every path returns a result object so callers
 * (chat route, CLI) can render it as a plain row.
 */

import { resolve } from './registry.js';
import { buildCtx, observerBus, hudProducer, clampText, redact } from './_context.js';

/* ── parser ────────────────────────────────────────────────────────────── */

/**
 * Parse `/name arg1 arg2 --flag value --bool --other "quoted value"`.
 * Returns { name, positional: string[], flags: Record<string, string|true>, raw }
 * or null when the input is not a slash command.
 */
export function parse(input) {
  const text = String(input ?? '').trim();
  if (!text.startsWith('/')) return null;
  const m = text.match(/^\/([A-Za-z][A-Za-z0-9_-]*)(?=$|[\s])/);
  if (!m) return null;
  const name = m[1].toLowerCase();

  // tokenize the remainder (respects quotes)
  const rest = text.slice(m[0].length).trim();
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let t;
  while ((t = re.exec(rest))) tokens.push(t[1] ?? t[2] ?? t[3] ?? '');

  const positional = [];
  const flags = {};
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.startsWith('--') && tok.length > 2) {
      const key = tok.slice(2);
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = true;
    } else {
      positional.push(tok);
    }
  }
  return { name, positional, flags, raw: text };
}

/* ── arg validation ────────────────────────────────────────────────────── */

/**
 * Merge parsed positional/flags into the command's declared args schema.
 * Positionals fill declared non-flag args in order; --flag values fill args
 * by name. Returns { ok, args, error }.
 */
export function validateArgs(def, parsed) {
  const out = {};
  const schema = def.args || [];
  const posArgs = schema; // every declared arg can be filled positionally, in order
  let consumed = 0;

  for (const a of schema) {
    if (parsed.flags[a.name] !== undefined) {
      out[a.name] = parsed.flags[a.name] === true ? (a.default ?? true) : parsed.flags[a.name];
      continue;
    }
    if (consumed < parsed.positional.length) {
      out[a.name] = parsed.positional[consumed++];
      continue;
    }
    out[a.name] = a.default;
  }
  // any extra positionals ride along as _rest (never dropped silently)
  if (consumed < parsed.positional.length) out._rest = parsed.positional.slice(consumed);

  for (const a of posArgs) {
    if (a.required && (out[a.name] === undefined || out[a.name] === null || out[a.name] === '')) {
      return { ok: false, args: out, error: `missing required argument: ${a.name}${a.description ? ` (${a.description})` : ''}` };
    }
    if (out[a.name] !== undefined && a.type === 'number') {
      const n = Number(out[a.name]);
      if (Number.isNaN(n)) return { ok: false, args: out, error: `argument ${a.name} must be a number (got "${out[a.name]}")` };
      out[a.name] = n;
    }
    if (out[a.name] !== undefined && a.type === 'boolean') {
      out[a.name] = out[a.name] === true || out[a.name] === 'true';
    }
  }
  return { ok: true, args: out, error: null };
}

/* ── dispatch ──────────────────────────────────────────────────────────── */

async function emitBus(bus, type, payload) {
  if (!bus) return null;
  try { return bus.emit(type, payload); } catch { return null; }
}

/**
 * Dispatch a slash-command input through the registry.
 * Returns:
 *   { handled: true, ok, name, summary, result?, error?, durationMs, events }
 *   { handled: false, reason: 'not-a-command' | 'unknown-command', error? }
 */
export async function dispatch(input, ctxOverrides = {}) {
  const parsed = parse(input);
  if (!parsed) return { handled: false, reason: 'not-a-command' };

  const def = resolve(parsed.name);
  if (!def) {
    const known = await _listNames();
    return {
      handled: false,
      reason: 'unknown-command',
      name: parsed.name,
      error: `unknown command /${parsed.name}${known ? ` — known commands: ${known}` : ' — command registry unavailable'}`,
    };
  }

  const ctx = await buildCtx(ctxOverrides);
  const bus = await observerBus();
  const started = Date.now();

  const v = validateArgs(def, parsed);
  if (!v.ok) {
    await emitBus(bus, 'command.failed', {
      summary: `/${def.name} rejected: ${v.error}`,
      data: { command: def.name, error: v.error, phase: 'validate' },
    });
    ctx.log(`✗ /${def.name}: ${v.error}`);
    return { handled: true, ok: false, name: def.name, error: v.error, durationMs: 0, ctx };
  }

  await emitBus(bus, 'command.executed', {
    summary: `command /${def.name} executed by ${ctx.agent.name}`,
    data: { command: def.name, aliases: def.aliases, category: def.category, args: _safeArgs(v.args), session: ctx.session.id },
  });
  ctx.log(`⚙ /${def.name} — ${def.description}`);

  try {
    const result = await def.handler(v.args, ctx) ?? {};
    const durationMs = Date.now() - started;
    const ok = result?.ok !== false;
    const summary = clampText(redact(result?.summary || (ok ? `/${def.name} done.` : `/${def.name} failed.`)), 500);

    await emitBus(bus, ok ? 'command.completed' : 'command.failed', {
      summary: `${ok ? '✓' : '✗'} /${def.name} — ${summary}`,
      data: { command: def.name, ok, durationMs, result: _shrink(result) },
    });
    await _hudBump(`command:${def.name}`);

    if (ok) ctx.log(`✓ /${def.name} finished (${durationMs}ms)`);
    else ctx.log(`✗ /${def.name}: ${clampText(result?.error || 'failed', 300)}`);

    return { handled: true, ok, name: def.name, summary, result, durationMs, ctx };
  } catch (e) {
    const durationMs = Date.now() - started;
    const error = clampText(String((e && e.message) || e), 400);
    await emitBus(bus, 'command.failed', {
      summary: `command /${def.name} failed: ${error}`,
      data: { command: def.name, error, durationMs },
    });
    await _hudBump(`command:${def.name}`);
    ctx.log(`✗ /${def.name} threw: ${error}`);
    return { handled: true, ok: false, name: def.name, error, durationMs, ctx };
  }
}

/** Try a command; null when the input is not one of OUR commands. */
export async function tryDispatch(input, ctxOverrides = {}) {
  const r = await dispatch(input, ctxOverrides);
  if (r.handled) return r;
  return null; // not-a-command and unknown-command both fall through to legacy behavior
}

/* ── internals ─────────────────────────────────────────────────────────── */

async function _listNames() {
  try {
    const reg = await import('./registry.js');
    return reg.list().map((c) => `/${c.name}`).join(' ');
  } catch { return null; }
}

function _safeArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (k.startsWith('_')) continue;
    out[k] = typeof v === 'string' && v.length > 200 ? `${v.slice(0, 199)}…` : v;
  }
  return out;
}

function _shrink(result) {
  if (!result || typeof result !== 'object') return result ?? null;
  try {
    const s = JSON.stringify(result, (k, val) => (typeof val === 'string' && val.length > 500 ? `${val.slice(0, 499)}…` : val));
    return s.length > 2000 ? JSON.parse(s.slice(0, 1999) + '"}') : result;
  } catch { return { summary: result.summary ?? null }; }
}

/** HUD revision bump through the producer's PUBLIC trigger (fail-soft). */
async function _hudBump(reason) {
  try {
    const p = await hudProducer();
    if (p && typeof p.schedulePublish === 'function') p.schedulePublish(reason);
  } catch { /* HUD optional in standalone runs */ }
}
