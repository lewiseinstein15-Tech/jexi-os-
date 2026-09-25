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
 *   {type:'log', agent, message}   -> narrate progress   (stage/tool logs)
 *   {type:'plan', steps, roster}   -> narrate decision   (plan summary)
 *   {type:'think', by, text}       -> buffered; rendered as ONE recon line
 *                                     when the answer starts (no spam)
 *   {type:'narration', text}       -> narrate finding
 *   {type:'stream', text, by?}     -> text delta  (the streaming answer)
 *   {type:'done', summary, success, sources} -> answer fallback + completion
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
    let thinkBuf = '';
    let answerStarted = false;
    let streamedAnswer = false;
    let sources = null;

    const flushThinking = function* () {
      if (thinkBuf) {
        yield {
          kind: 'narrate',
          type: 'recon',
          ctx: { input: clip(thinkBuf, 240), source: 'model-reasoning' },
        };
        thinkBuf = '';
      }
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
              yield {
                kind: 'narrate',
                type: 'decision',
                ctx: {
                  input: `plan composed · ${steps.length} step${steps.length === 1 ? '' : 's'}${roster.length ? ` · team: ${clip(roster.join(', '), 80)}` : ''}`,
                  source: 'planner',
                },
              };
            }
            break;
          }
          case 'think': {
            if (ev.text) thinkBuf += String(ev.text);
            break;
          }
          case 'stream': {
            if (ev.text) {
              if (!answerStarted) {
                yield* flushThinking();
                answerStarted = true;
              }
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
          case 'done': {
            yield* flushThinking();
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
            yield {
              kind: 'narrate',
              type: 'completion',
              ctx: {
                input: sources && sources.length
                  ? `answer complete · ${ms} ms · ${sources.length} source${sources.length === 1 ? '' : 's'}`
                  : `answer complete · ${ms} ms`,
                source: 'pipeline-done',
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
