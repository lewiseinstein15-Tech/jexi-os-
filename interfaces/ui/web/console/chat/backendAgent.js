/**
 * ui-rebuild-premium — REAL backend chat agent.
 *
 * The Phase 16 runtime ships a deterministic keyword-driven defaultAgent
 * (runtime.js) that never touches a model — the root cause of "chat returns
 * canned stub responses". This module is the replacement agent passed to
 * runtime.attach(sessionId, { agent }) by mount.js: it dispatches the user
 * text to the REAL model pipeline (POST /api/chat, the boot-time provider
 * bridge — see server/index.js:1648 and server/src/wiring/phase31-providers.js)
 * and translates the NDJSON event stream into Phase 16 agent intents:
 *
 *   {type:'log', agent, message}   -> progress narration (executed steps in
 *                                     the Arena step list)
 *   {type:'plan', steps, roster}   -> decision narration carrying the REAL
 *                                     plan lines (rendered as pending steps)
 *   {type:'think', by, text}       -> recon narration PER CHUNK — thinking
 *                                     streams into the ThinkingBlock as it
 *                                     arrives (mount merges consecutive
 *                                     recon rows into one growing block)
 *   {type:'narration', text}       -> narrate finding
 *   {type:'stream', text, by?}     -> text delta  (the streaming answer)
 *   {type:'tool_use', id, tool, status, duration_ms, summary, detail}
 *                                  -> progress narration carrying the REAL
 *                                     ToolUseBridge payload (server-side tool
 *                                     runs) — mount converts it to the tool
 *                                     row family so CommandBlock/ToolCallBlock
 *                                     render real paired executions
 *   {type:'done', summary, success, sources, statistics?} -> completion
 *   anything else (team/intel/agent.done/subagent.aggregate) -> telemetry, skipped
 *
 * The generator protocol is exactly what runtime.js handleIntent consumes
 * (narrate / text / fail). No backend routes are invented: /api/chat is the
 * shipped brain endpoint. If it is unreachable the turn FAILS honestly with
 * E_BACKEND_* — nothing is faked.
 */

const TELEMETRY_TYPES = new Set(['team', 'intel', 'agent.done', 'subagent.aggregate', 'agent.log']);

function clip(text, max) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function oneLine(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

export function backendAgent({ endpoint = '/api/chat' } = {}) {
  return async function* agent(ctx) {
    const userInput = String((ctx && ctx.userInput) || '');
    const turnId = (ctx && ctx.turnId) || 'turn';
    const src = `dispatch:${turnId}`;

    yield {
      kind: 'narrate',
      type: 'acknowledge',
      ctx: { input: clip(userInput, 120), source: src },
    };

    let res;
    const t0 = Date.now();
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userInput }),
      });
    } catch (e) {
      yield { kind: 'fail', code: 'E_BACKEND_UNREACHABLE', message: `${endpoint}: ${String((e && e.message) || e)}` };
      return;
    }
    if (!res.ok || !res.body) {
      let detail = '';
      try { const j = await res.json(); detail = j && j.error ? ` — ${clip(j.error, 160)}` : ''; } catch { /* body not json */ }
      yield { kind: 'fail', code: 'E_BACKEND_HTTP', message: `${endpoint} replied HTTP ${res.status}${detail}` };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let streamedAnswer = false;
    let sources = null;

    // ui-rebuild-premium-v2 — think chunks stream out as recon narrations
    // the moment they arrive; mount.js merges consecutive recon rows of the
    // same turn into one growing ThinkingBlock. No content is dropped and
    // nothing is held back to be rendered later.
    const emitThinking = function* (chunk) {
      const t = String(chunk || '').trim();
      if (!t) return;
      yield {
        kind: 'narrate',
        type: 'recon',
        ctx: { input: t.slice(0, 400), source: 'model-reasoning' },
      };
    };

    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (e) {
        yield { kind: 'fail', code: 'E_BACKEND_STREAM', message: `stream read failed: ${String((e && e.message) || e)}` };
        return;
      }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }

        if (TELEMETRY_TYPES.has(ev.type)) continue;

        switch (ev.type) {
          case 'log': {
            if (ev.message) {
              const who = String(ev.agent || 'JEXI');
              yield {
                kind: 'narrate',
                type: 'progress',
                ctx: { input: `${who}: ${clip(ev.message, 200)}`, source: 'pipeline-log' },
              };
            }
            break;
          }
          case 'plan': {
            const steps = Array.isArray(ev.steps) ? ev.steps : [];
            const roster = Array.isArray(ev.roster) ? ev.roster : [];
            if (steps.length || roster.length) {
              // The REAL plan lines go to the UI: header + numbered steps.
              // Multi-line input is deliberate — StepList parses it. Capped
              // at 1200 chars to protect the row store, never re-wrapped.
              const lines = [
                `plan composed · ${steps.length} step${steps.length === 1 ? '' : 's'}${roster.length ? ` · team: ${clip(roster.join(', '), 80)}` : ''}`,
                ...steps.slice(0, 12).map((s, i) => `${i + 1}. ${oneLine(s)}`),
              ];
              yield {
                kind: 'narrate',
                type: 'decision',
                ctx: { input: lines.join('\n').slice(0, 1200), source: 'planner' },
              };
            }
            break;
          }
          case 'think': {
            if (ev.text) yield* emitThinking(ev.text);
            break;
          }
          case 'stream': {
            if (ev.text) {
              streamedAnswer = true;
              yield { kind: 'text', delta: String(ev.text) };
            }
            break;
          }
          case 'narration': {
            if (ev.text) {
              yield {
                kind: 'narrate',
                type: 'finding',
                ctx: { input: clip(ev.text, 240), source: 'narration' },
              };
            }
            break;
          }
          case 'tool_use': {
            // Real server-side tool run (ToolUseBridge shape: paired
            // running->success/error with toolId, duration_ms, $ detail).
            // Relayed verbatim inside the narration ctx — mount converts it
            // to the tool row family. Nothing is invented here.
            const tu = ev || {};
            yield {
              kind: 'narrate',
              type: 'progress',
              ctx: {
                input: clip(tu.summary || tu.detail || `tool ${tu.tool || ''}`, 200),
                source: `tool-use:${tu.tool || tu.slug || 'tool'}`,
                ctx: {
                  toolUse: {
                    id: tu.id || null,
                    tool: tu.tool || null,
                    slug: tu.slug || null,
                    status: tu.status || 'running',
                    duration_ms: Number(tu.duration_ms) || 0,
                    summary: tu.summary ? String(tu.summary).slice(0, 200) : null,
                    detail: tu.detail ? String(tu.detail).slice(0, 500) : null,
                  },
                },
              },
            };
            break;
          }
          case 'done': {
            const ok = ev.success !== false;
            const summary = String(ev.summary || '');
            if (!streamedAnswer && summary) {
              // The stream never delivered visible text — the done summary IS
              // the answer (B157 contract server-side). Render it verbatim.
              yield { kind: 'text', delta: summary };
              streamedAnswer = true;
            }
            if (!ok) {
              yield {
                kind: 'fail',
                code: 'E_TURN_FAILED',
                message: clip(ev.error || summary || 'turn failed', 200),
              };
              return;
            }
            sources = Array.isArray(ev.sources) ? ev.sources.filter(Boolean) : null;
            const ms = Date.now() - t0;
            // BUG 1 (ui-rebuild-premium-v2) — the done event's
            // statistics.meter.calls carry the REAL model calls of this turn
            // ("provider:model" strings, failed attempts suffixed "(failed)").
            // The last successful call is what answered the user; relay it in
            // the completion narration ctx so mount.js can feed the shared
            // model-status signal (chip/footer show the per-turn truth).
            const calls = (ev.statistics && ev.statistics.meter && Array.isArray(ev.statistics.meter.calls))
              ? ev.statistics.meter.calls
              : [];
            const okCall = [...calls].reverse().find((c) => typeof c === 'string' && c && !c.endsWith('(failed)'));
            let turnProvider = null;
            if (okCall) {
              const colon = okCall.indexOf(':');
              turnProvider = colon > 0
                ? { provider: okCall.slice(0, colon), model: okCall.slice(colon + 1) }
                : { provider: okCall, model: null };
            }
            yield {
              kind: 'narrate',
              type: 'completion',
              ctx: {
                input: sources && sources.length
                  ? `answer complete · ${ms} ms · ${sources.length} source${sources.length === 1 ? '' : 's'}`
                  : `answer complete · ${ms} ms`,
                source: 'pipeline-done',
                ...(turnProvider ? { ctx: { turnProvider } } : {}),
              },
            };
            return;
          }
          default:
            break; // unknown event types are skipped, never guessed at
        }
      }
    }

    // Stream closed without a done event — fail honestly.
    if (!streamedAnswer) {
      yield {
        kind: 'fail',
        code: 'E_BACKEND_TRUNCATED',
        message: 'stream ended without a done event (no answer rendered)',
      };
    }
  };
}
