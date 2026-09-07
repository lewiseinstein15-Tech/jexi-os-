/**
 * ARENA Phase 6 — LIVE BENCHMARK (spec Parts 1/35/38): model calls + latency
 * per request class, measured against the RUNNING brain. Honest by design:
 * whatever happens (including provider failures) is recorded as-is.
 *
 * Classes measured:
 *   smalltalk (hello / thanks / bye / identity / how-are-you) — MUST be 0 calls
 *   question  — one real question through the full pipeline (whatever it costs today)
 */
const BRAIN = process.env.BRAIN_URL || 'http://127.0.0.1:3002';

async function turn(query, timeoutMs = 120_000) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let firstTokenMs = null;
  let done = null;
  try {
    const res = await fetch(`${BRAIN}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done: rd } = await reader.read();
      if (rd) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const d = JSON.parse(line);
          if (firstTokenMs === null && (d.type === 'stream' || d.type === 'log')) firstTokenMs = Date.now() - t0;
          if (d.type === 'done') done = d.done || d;
        } catch { /* partial line */ }
      }
    }
  } catch (e) {
    return { query, error: String(e && e.message || e).slice(0, 120), wallMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
  const wallMs = Date.now() - t0;
  const st = (done && done.statistics) || {};
  const meter = st.meter || {};
  return {
    query,
    wallMs,
    firstTokenMs,
    fastPath: st.fastPath === true,
    modelCalls: meter.modelCalls ?? st.modelCalls ?? null,
    providers: meter.modelCallsByProvider || null,
    failedCalls: meter.modelCallsFailed ?? null,
    stages: (meter.stages || []).map((x) => `${x.stage}:${x.ms}ms`).join(' '),
    answer: String((done && done.summary) || '').slice(0, 90),
    ok: Boolean(done && done.success !== false),
  };
}

const fmt = (r) => {
  const calls = r.modelCalls === null ? '?' : r.modelCalls;
  return `"${r.query.slice(0, 26)}" ${String(Math.round(r.wallMs)).padStart(6)}ms  calls=${calls}${r.failedCalls ? ` (failed ${r.failedCalls})` : ''}${r.providers ? ` ${JSON.stringify(r.providers)}` : ''}${r.fastPath ? '  [fast-path]' : ''}  ${r.error ? 'ERROR: ' + r.error : r.answer}`;
};

console.log('ARENA LIVE BENCHMARK — ' + new Date().toISOString());
console.log('══ smalltalk (must be ZERO model calls) ══');
const small = [];
for (const q of ['hello', 'thanks boss', 'see you later', 'who built you?', 'how are you', 'niaje']) {
  const r = await turn(q, 20_000);
  small.push(r);
  console.log(fmt(r));
}
const zeroCallOk = small.every((r) => r.modelCalls === 0 && r.ok);
const smallAvg = Math.round(small.reduce((a, r) => a + r.wallMs, 0) / small.length);
console.log(`→ smalltalk: ${zeroCallOk ? 'ALL ZERO-CALL ✓' : 'FAIL — a model call leaked'} · avg ${smallAvg}ms`);

console.log('══ one real question (full pipeline, honest cost today) ══');
const q1 = await turn('What is the capital of Kenya? One sentence.', 150_000);
console.log(fmt(q1));

console.log('══ provider health (this minute, this host) ══');
try {
  const h = await (await fetch(`${BRAIN}/api/health`)).json();
  const rows = (h.providers || []).map((p) => `${p.provider}:${p.ok}/${p.calls}ok${p.inCooldown ? '(cooldown)' : ''}`).join('  ');
  console.log(rows || 'no provider data');
} catch (e) { console.log('health unavailable:', String(e).slice(0, 80)); }

// machine-readable record for the report
const fs = await import('node:fs');
fs.writeFileSync('docs/arena-benchmark-live.json', JSON.stringify({ at: new Date().toISOString(), smalltalk: { zeroCallOk, avgMs: smallAvg, runs: small }, question: q1 }, null, 1));
console.log('saved: docs/arena-benchmark-live.json');
