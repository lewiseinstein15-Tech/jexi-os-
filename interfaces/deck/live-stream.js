/**
 * JEXI live streaming bridge — the browser side of POST /api/chat.
 *
 * The server answers /api/chat with NDJSON: one JSON object per line, shaped
 * `{ type, ...data }`. Types seen on the wire: log, agent.log, agent.plan,
 * stream, think, done, agent.done, intel, plan, command, command.done.
 *
 * Everything here is DOM-free on purpose: the parsing and the event mapping
 * are the parts that break, so they must be testable in Node without a
 * browser. `tests/tickets/jexi-live-stream.test.js` imports this exact file.
 */

/* ── NDJSON ───────────────────────────────────────────────────────────
 * A chunk boundary can fall anywhere, including the middle of a line or
 * the middle of a UTF-8 sequence. A line-oriented split() on each chunk
 * silently drops the tail of every partial line, which is the classic
 * "the answer is missing its last sentence" streaming bug. So the buffer
 * is carried across chunks and only complete lines are consumed. */
export function createNdjsonReader() {
  let buf = '';
  return {
    /** Feed a decoded chunk; returns the complete lines it produced. */
    push(chunk) {
      buf += chunk;
      const lines = [];
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) lines.push(line);
      }
      return lines;
    },
    /** Lines still held back because no newline has arrived yet. */
    rest() { return buf; },
    /** Force the trailing partial line out (server closed without a newline). */
    flush() {
      const t = buf.trim();
      buf = '';
      return t ? [t] : [];
    },
  };
}

/* ── event → deck row ────────────────────────────────────────────────
 * The deck renders rows as { n: name, k: kind, i: icon, d: detail-html }.
 * `k` is one of the CSS classes: ok / err / tool / plan / hook / mem. */
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // detail is rendered as innerHTML, so a quote must not be able to break out
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const clip = (s, n = 220) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

export const TERMINAL_TYPES = new Set(['done', 'agent.done']);

/**
 * Map one wire event to a deck row.
 * @returns {{n:string,k:string,i:string,d:string}|null} null = not renderable
 */
export function mapEvent(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const t = ev.type;
  switch (t) {
    case 'agent.plan':
      return { n: 'agent.plan', k: 'plan', i: '⌁', d:
        `intent <em>${esc(ev.intent)}</em> · ${esc((ev.tools || []).length)} tools` +
        (ev.codeMode ? ' · <em>code mode</em>' : '') };
    case 'stream':
      // The answer itself is rendered in the answer surface, not as a row.
      return { n: 'stream', k: 'ok', i: '✍', d: `+${(ev.text || '').length} chars${ev.by ? ` · <em>${esc(ev.by)}</em>` : ''}` };
    case 'think':
      return { n: 'think', k: 'mem', i: '◇', d: clip(ev.text) || '(reasoning)' };
    case 'log':
    case 'agent.log':
      return { n: 'agent.log', k: 'hook', i: '·', d: esc(clip(ev.message, 300)) };
    case 'intel':
      return { n: 'intel', k: 'mem', i: '◈', d: esc(clip(JSON.stringify(ev))) };
    case 'command':
      return { n: 'command', k: 'tool', i: '▸', d: esc(clip(ev.cmd || ev.command || '')) };
    case 'command.done':
      return { n: 'command.done', k: ev.exit === 0 ? 'ok' : 'err', i: ev.exit === 0 ? '✓' : '✕',
        d: `exit <em>${esc(ev.exit)}</em> · ${esc(clip(ev.stdout || ev.stderr || '', 120))}` };
    case 'subagent.aggregate':
      return { n: 'subagent.aggregate', k: 'plan', i: '⌁', d: esc(clip(JSON.stringify(ev), 200)) };
    default:
      // Unknown type is still real — show it, never drop it silently.
      return { n: t || 'event', k: 'hook', i: '·', d: esc(clip(JSON.stringify(ev), 200)) };
  }
}

/** Terminal payload, normalized across the two terminal shapes. */
export function readTerminal(ev) {
  if (!TERMINAL_TYPES.has(ev?.type)) return null;
  const answer = ev.summary ?? ev.answer ?? ev.text ?? '';
  return {
    type: ev.type,
    answer: typeof answer === 'string' ? answer : '',
    stats: ev.stats || null,
    verification: ev.verification || null,
    recoverable: ev.recoverable === true,
  };
}

/* ── the bridge ─────────────────────────────────────────────────────── */

export class LiveBridge {
  /**
   * @param {object} o
   * @param {(row:{n,k,i,d})=>void} o.onEvent     a renderable row
   * @param {(text:string)=>void} o.onDelta       an answer delta
   * @param {(s:object)=>void}    o.onState       lifecycle/status change
   * @param {typeof fetch}        [o.fetchImpl]   injectable for tests
   * @param {string}             [o.endpoint]     defaults to same-origin
   */
  constructor({ onEvent = () => {}, onDelta = () => {}, onState = () => {}, fetchImpl, endpoint = '/api/chat' } = {}) {
    this.onEvent = onEvent;
    this.onDelta = onDelta;
    this.onState = onState;
    this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    this.endpoint = endpoint;
    this.answer = '';
    this.busy = false;
    this.ctrl = null;
    this.terminal = null;
    this.malformed = 0;
    this.deltas = 0;
  }

  abort() {
    if (this.ctrl) { try { this.ctrl.abort(); } catch { /* already gone */ } }
  }

  /** POST a question and consume the NDJSON stream to completion. */
  async send(question, { convId } = {}) {
    const q = String(question ?? '').trim();
    if (!q) return { ok: false, reason: 'empty' };
    if (this.busy) return { ok: false, reason: 'busy' };

    this.busy = true;
    this.answer = ''; this.terminal = null; this.malformed = 0; this.deltas = 0;
    this.ctrl = new AbortController();
    this.onState({ phase: 'open', question: q });

    const reader = createNdjsonReader();
    let result = { ok: false, reason: 'unknown' };

    try {
      const res = await this.fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({ query: q, ...(convId ? { convId } : {}) }),
        signal: this.ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        result = { ok: false, reason: `HTTP ${res.status}`, detail: clip(body, 300) };
        this.onState({ phase: 'error', ...result });
        return result;
      }
      if (!res.body) {
        // No body means nothing can stream. Say so instead of showing a
        // silent, empty "success".
        result = { ok: false, reason: 'no response body — cannot stream' };
        this.onState({ phase: 'error', ...result });
        return result;
      }

      const dec = new TextDecoder();
      for await (const chunk of readChunks(res.body)) {
        // ONLY push here. flush() empties the carry buffer, so calling it per
        // chunk hands out the half-received tail as if it were a whole line —
        // which parses as garbage, counts as malformed, and silently loses the
        // rest of that event. The buffer is drained exactly once, at the end.
        for (const line of reader.push(dec.decode(chunk, { stream: true }))) this.ingest(line);
        if (this.terminal) break;
      }
      if (!this.terminal) {
        for (const line of reader.flush()) this.ingest(line);
      }

      // A stream that ended with no terminal event is not a success.
      if (!this.terminal) {
        result = { ok: false, reason: 'stream ended without a terminal event', answer: this.answer };
        this.onState({ phase: 'error', ...result });
        return result;
      }
      // The server buffers math/backticked tails, so the terminal summary is
      // authoritative; the deltas are what the user watched arrive.
      if (this.terminal.answer && this.terminal.answer !== this.answer) {
        this.answer = this.terminal.answer;
      }
      result = { ok: true, answer: this.answer, terminal: this.terminal, malformed: this.malformed, deltas: this.deltas };
      this.onState({ phase: 'done', ...result });
      return result;

    } catch (e) {
      const aborted = e?.name === 'AbortError';
      result = { ok: false, reason: aborted ? 'aborted' : (e?.message || 'network error'), aborted, answer: this.answer };
      this.onState({ phase: aborted ? 'aborted' : 'error', ...result });
      return result;
    } finally {
      this.busy = false;
      this.ctrl = null;
    }
  }

  /** Handle one NDJSON line. Returns true when a terminal event was seen. */
  ingest(line) {
    let ev;
    try { ev = JSON.parse(line); }
    catch { this.malformed++; return false; }          // one bad line must not kill the stream

    const term = readTerminal(ev);
    if (term) { this.terminal = term; return true; }

    if (ev.type === 'stream' && typeof ev.text === 'string' && ev.text) {
      this.answer += ev.text;
      this.deltas++;
      this.onDelta(ev.text);
    }
    const row = mapEvent(ev);
    if (row) this.onEvent(row);
    return false;
  }
}

/** Iterate a fetch ReadableStream, also handling Node's async-iterable form. */
export async function* readChunks(body) {
  if (typeof body[Symbol.asyncIterator] === 'function') {
    for await (const c of body) yield c;
    return;
  }
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally { try { reader.releaseLock(); } catch { /* already released */ } }
}
