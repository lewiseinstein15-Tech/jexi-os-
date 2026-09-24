/**
 * JEXI CLI — terminal rendering + REPL + one-shot + missions.
 *
 * Renders the backend's NDJSON event stream as a calm engineering transcript:
 * the ANSWER streams on stdout; progress, reasoning and evidence ride stderr
 * as short dim lines. `ask.secret` pauses for a one-time paste (never stored).
 */
import readline from 'node:readline';
import { promptHidden } from './wizard.js';

const NO_COLOR = !!process.env.NO_COLOR || !process.stderr.isTTY;
const c = {
  dim: (s) => (NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`),
  red: (s) => (NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`),
  green: (s) => (NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`),
  cyan: (s) => (NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`),
  bold: (s) => (NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`),
};
const err = (s) => process.stderr.write(`${s}\n`);

/**
 * Render one chat event. Returns { secretAsk } when the backend needs a
 * one-time GitHub key paste (caller handles the prompt + answer post).
 */
export function renderEvent(evt, { stdout = process.stdout } = {}) {
  if (!evt || typeof evt !== 'object') return {};
  const t = evt.type;
  if (t === 'stream' && evt.text) {
    stdout.write(String(evt.text));
    return {};
  }
  if (t === 'think' && evt.text) {
    err(c.dim(`  … ${truncate(String(evt.text).replace(/\n+/g, ' '), 220)}`));
    return {};
  }
  if ((t === 'log' || t === 'agent.log') && evt.message) {
    const who = evt.agent ? `[${evt.agent}] ` : '';
    err(c.dim(`  · ${who}${truncate(String(evt.message).replace(/\n+/g, ' '), 240)}`));
    return {};
  }
  if (t === 'plan' && evt) {
    const steps = Array.isArray(evt.steps) ? evt.steps.map((x) => (x && (x.title || x.name)) || '').filter(Boolean) : [];
    const label = evt.title || evt.summary || (steps.length ? steps.slice(0, 4).join(' → ') : '') || 'working…';
    err(c.cyan(`  ▸ plan: ${truncate(String(label).replace(/\n+/g, ' '), 160)}`));
    if (steps.length > 4) err(c.dim(`    +${steps.length - 4} more steps`));
    return {};
  }
  if (t === 'intel' && evt.message) {
    err(c.dim(`  ◆ ${truncate(String(evt.message), 200)}`));
    return {};
  }
  if ((t === 'agent.done' || t === 'subagent.aggregate') && (evt.summary || evt.agent)) {
    err(c.dim(`  ✓ ${evt.agent || 'subagent'}${evt.summary ? `: ${truncate(String(evt.summary).replace(/\n+/g, ' '), 200)}` : ''}`));
    return {};
  }
  if (t === 'ask.secret') {
    return { secretAsk: { conv: evt.conv || 'default', id: evt.id, tool: evt.tool, reason: evt.reason } };
  }
  if (t === 'done') {
    stdout.write('\n');
    if (evt.summary) stdout.write(`${String(evt.summary).trim()}\n`);
    const meta = [];
    if (evt.by || evt.writer) meta.push(`writer: ${evt.by || evt.writer}`);
    if (evt.firstTokenMs != null) meta.push(`first token ${evt.firstTokenMs}ms`);
    if (evt.durationMs != null) meta.push(`${evt.durationMs}ms`);
    if (meta.length) err(c.dim(`  ⚡ ${meta.join(' · ')}`));
    return { terminal: true };
  }
  if (t === 'error') {
    err(c.red(`  ✕ ${evt.error || evt.message || 'unknown error'}`));
    return { terminal: true, failed: true };
  }
  return {};
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** One chat turn with secret-ask handling. Returns the terminal event. */
export async function runTurn(api, query, { image = null } = {}) {
  let failed = false;
  const r = await api.chatStream(query, {
    image,
    onEvent: (evt) => {
      const out = renderEvent(evt);
      if (out.failed) failed = true;
      if (out.secretAsk && out.secretAsk.id) {
        pendingSecretAsk = out.secretAsk;
      }
    },
  });
  // Answer a pending one-time secret ask (paste → POST → continue).
  if (pendingSecretAsk) {
    const ask = pendingSecretAsk;
    pendingSecretAsk = null;
    err(c.cyan(`\n  JEXI needs a one-time GitHub key${ask.reason ? ` ${ask.reason}` : ''} (${ask.tool || 'github'}).`));
    err(c.dim('  Paste it — it is held in memory only, never stored. (Enter to skip)'));
    const value = await promptHidden('  GitHub key');
    if (value) {
      const ans = await api.secretsAnswer({ conv: ask.conv, id: ask.id, value });
      if (ans.ok && ans.data && ans.data.ok) {
        err(c.green('  Key accepted — continuing the turn…'));
        return runTurn(api, `continue: ${query}`, { image });
      }
      err(c.red(`  Key rejected: ${(ans.data && ans.data.error) || `HTTP ${ans.status}`}`));
    }
  }
  if (failed) throw new Error('turn failed — see the error above');
  return r.done;
}
let pendingSecretAsk = null;

/** One-shot: `jexi "query"`. */
export async function runOneShot(api, query, opts = {}) {
  const t0 = Date.now();
  err(c.dim(`  workspace: ${opts.workspace || '(backend default)'}`));
  await runTurn(api, query, opts);
  err(c.dim(`  done in ${Date.now() - t0}ms`));
}

/** Interactive REPL. */
export async function runRepl(api, { workspace = '' } = {}) {
  err(c.bold('JEXI') + c.dim(` — ${api.baseUrl} · workspace ${workspace || '(backend)'}`));
  err(c.dim('  Type a task. /new resets the session · /models · /doctor · /exit\n'));
  const r = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: c.cyan('› ') });
  let sessionN = 1;
  r.prompt();
  for await (const line of r) {
    const q = line.trim();
    if (!q) { r.prompt(); continue; }
    if (q === '/exit' || q === '/quit') { r.close(); return; }
    if (q === '/new') {
      sessionN += 1;
      api.session = `cli-${process.pid}-${sessionN}`;
      err(c.dim('  new session started'));
      r.prompt();
      continue;
    }
    if (q === '/models') {
      try {
        const a = await api.providersActive();
        err(`  ${JSON.stringify(a.data, null, 1).split('\n').join('\n  ')}`);
      } catch (e) { err(c.red(`  ${e.message}`)); }
      r.prompt();
      continue;
    }
    if (q === '/doctor') { r.close(); process.exitCode = 2; return; } // host re-dispatches
    if (q === '/help') {
      err(c.dim('  /new — fresh session · /models — active model · /doctor — health · /exit — quit'));
      r.prompt();
      continue;
    }
    try {
      await runTurn(api, q);
    } catch (e) {
      err(c.red(`  ✕ ${e.message}`));
    }
    err('');
    r.prompt();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `jexi run "objective"` — persistent mission with progress polling.
 * Returns the final snapshot.
 */
export async function runMission(api, objective, { pollMs = 2000, timeoutMs = 30 * 60 * 1000 } = {}) {
  const created = await api.createMission({ objective });
  if (!created.ok || !created.data || !created.data.ok) {
    throw new Error(`mission rejected: ${JSON.stringify(created.data).slice(0, 300)}`);
  }
  const id = created.data.missionId;
  err(c.bold(`Mission ${id}`) + c.dim(` — ${truncate(objective, 120)}`));
  const t0 = Date.now();
  let since = '';
  let lastState = '';
  const FINAL = new Set(['DONE', 'FAILED', 'CANCELLED', 'SKIPPED', 'SUPERSEDED']);
  for (;;) {
    const ev = await api.missionEvents(id, since).catch(() => null);
    const events = (ev && ev.data && ev.data.events) || [];
    for (const e of events) {
      since = e.id || e.eventId || since;
      renderMissionEvent(e);
    }
    const snap = await api.missionSnapshot(id).catch(() => null);
    const m = (snap && snap.data && (snap.data.mission || snap.data)) || {};
    const state = m.state || m.status || '';
    if (state && state !== lastState) {
      lastState = state;
      err(c.cyan(`  ▸ ${state}`));
    }
    if (state && FINAL.has(String(state).toUpperCase())) {
      const failed = String(state).toUpperCase() === 'FAILED';
      err(failed ? c.red(`  ✕ mission ${state}`) : c.green(`  ✓ mission ${state} (${Date.now() - t0}ms)`));
      const summary = m.summary || m.result || (m.report && m.report.summary);
      if (summary) err(`\n${String(summary).trim()}`);
      return m;
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`mission timed out after ${Math.round(timeoutMs / 1000)}s (mission ${id} still ${lastState || 'running'} — check "jexi missions")`);
    await sleep(pollMs);
  }
}

function renderMissionEvent(e) {
  const type = String(e.type || e.kind || '');
  const msg = e.summary || e.message || e.text || '';
  if (/VERIFY|VERIFICATION/i.test(type)) err(c.dim(`  ◆ verify: ${truncate(String(msg), 180)}`));
  else if (/TEST/i.test(type)) err(c.dim(`  ◆ test: ${truncate(String(msg), 180)}`));
  else if (/FAIL|ERROR/i.test(type)) err(c.red(`  ✕ ${truncate(String(msg || type), 180)}`));
  else if (/COMPLETE|PASS/i.test(type)) err(c.green(`  ✓ ${truncate(String(msg || type), 180)}`));
  else if (/PLAN/i.test(type)) err(c.cyan(`  ▸ plan: ${truncate(String(msg || type), 180)}`));
  else if (msg) err(c.dim(`  · ${truncate(String(msg).replace(/\n+/g, ' '), 180)}`));
}
