/**
 * JEXI TUI — frame composition.
 *
 * Pure view math: given a transcript, a terminal size and a scroll offset,
 * produce the array of lines that make up one frame. The app owns the raw
 * terminal and only ever writes what composeView returns, so the whole layout
 * is testable without a TTY.
 *
 * Layout:
 *   ┌ header ─────────────────────────────┐  (1 line)
 *   │ transcript (scrolling)              │  (rows - 5)
 *   ├ composer ───────────────────────────┤  (3 lines: rule, input, rule)
 *   └ status ─────────────────────────────┘  (1 line)
 */

import { paint, visibleWidth, wrap, truncate, oneLine } from './ansi.js';

export const CHROME_ROWS = 5; // header + 2 composer rules + input + status

function rule(width, token = 'rule') {
  return paint('─'.repeat(Math.max(0, width)), token);
}

/** The brand header: JEXI · backend · workspace · session. */
export function headerLines({ cols, baseUrl = '', workspace = '', sessionId = '', mode = 'local' }) {
  const left = paint('JEXI', 'ember', { bold: true }) + paint(' OS', 'peach') + paint(' · TUI', 'ink3');
  const mid = paint(`  ${baseUrl}`, 'ink3');
  const ws = workspace ? paint(`  ${oneLine(workspace, 60)}`, 'ink2') : '';
  const right = paint(`${mode} · ${sessionId}`, 'ink3');
  const plain = visibleWidth(`${left}${mid}${ws}`) + visibleWidth(right);
  if (plain + 2 > cols) return [truncate(`${left}${mid}${ws}`, cols)];
  return [`${left}${mid}${ws}${' '.repeat(Math.max(1, cols - visibleWidth(left + mid + ws) - visibleWidth(right)))}${right}`];
}

/**
 * Render one row to display lines (already wrapped and colored).
 * `cols` is the full terminal width; rows render with a 2-col gutter.
 */
export function rowLines(r, cols) {
  const w = Math.max(8, cols - 2);
  switch (r.kind) {
    case 'user':
      return [
        paint('› ', 'ember', { bold: true }) + paint(oneLine(r.text, w), 'ink', { bold: true }),
        ...wrap(r.text, w).slice(1).map((l) => `  ${paint(l, 'ink')}`),
      ];

    case 'text':
      return wrap(r.text || '', w).map((l, i) => (i === 0 ? `  ${paint(l, 'ink')}` : `  ${paint(l, 'ink')}`));

    case 'thinking':
      return wrap(r.text || '', w - 2).map((l) => `  ${paint(l, 'ink3', { italic: true })}`);

    case 'narration':
      return wrap(r.text || '', w - 2).map((l) => `  ${paint(l, 'ember')}`);

    case 'plan': {
      const steps = (r.meta && r.meta.steps) || [];
      const head = paint('▸ ', 'ember', { bold: true }) + paint(oneLine(r.text, w - 4), 'ember', { bold: true });
      const out = [`  ${head}`];
      for (const s of steps.slice(0, 12)) out.push(`    ${paint('· ', 'ink3')}${paint(oneLine(s, w - 6), 'ink2')}`);
      if (steps.length > 12) out.push(`    ${paint(`+${steps.length - 12} more steps`, 'ink3')}`);
      return out;
    }

    case 'tool-use':
    case 'tool-result':
    case 'tool-error': {
      const m = r.meta || {};
      const name = r.text || m.slug || 'tool';
      if (r.kind === 'tool-use') {
        const spin = m.status === 'running' ? '⠋' : '·';
        const args = m.args ? paint(`(${oneLine(m.args, Math.max(10, w - name.length - 12))})`, 'ink3') : '';
        return [`  ${paint(spin, 'peach')} ${paint(name, 'peach', { bold: true })}${args}`];
      }
      const ok = r.kind === 'tool-result';
      const mark = ok ? '✓' : '✕';
      const head = paint(`${mark} ${name}`, ok ? 'up' : 'down', { bold: true });
      const ms = m.durationMs ? paint(` ${m.durationMs}ms`, 'ink3') : '';
      const out = [`  ${head}${ms}`];
      const body = ok ? (m.detail || m.summary || '') : (m.error || m.summary || '');
      for (const l of wrap(body, w - 6).slice(0, 12)) out.push(`    ${paint(l, ok ? 'ink2' : 'down', { dim: true })}`);
      if (visibleWidth(body) > (w - 6) * 12) out.push(`    ${paint('… truncated', 'ink3')}`);
      return out;
    }

    case 'approval': {
      const d = (r.meta && r.meta.decision) || '';
      const sym = d === 'requested' ? '⏸ approval requested' : `approval ${d}`;
      return [
        `  ${paint(sym, 'gold', { bold: true })}`,
        ...wrap(r.text || '', w - 6).map((l) => `    ${paint(l, 'gold')}`),
      ];
    }

    case 'agent': {
      const m = r.meta || {};
      const verb = m.event === 'agent.completed' || m.event === 'agent.done' ? '✓' : '▸';
      const head = paint(`${verb} ${oneLine(r.text, 40)}`, 'peach', { bold: true });
      const tail = m.summary ? paint(`  ${oneLine(m.summary, w - 20)}`, 'ink2') : '';
      return [`  ${head}${tail}`];
    }

    case 'command': {
      const m = r.meta || {};
      const out = [`  ${paint('$ ', 'ink3')}${paint(oneLine(r.text || '', w - 4), 'ink', { bold: true })}`];
      for (const l of wrap(m.stdout || '', w - 6).slice(0, 10)) out.push(`    ${paint(l, 'ink2', { dim: true })}`);
      for (const l of wrap(m.stderr || '', w - 6).slice(0, 6)) out.push(`    ${paint(l, 'down', { dim: true })}`);
      if (m.status === 'success' || m.status === 'error') {
        out.push(`    ${paint(`exit ${m.exit ?? '?'}${m.durationMs ? ` · ${m.durationMs}ms` : ''}`, m.status === 'success' ? 'up' : 'down', { dim: true })}`);
      }
      return out;
    }

    case 'log': {
      const who = r.agent ? `${oneLine(r.agent, 16)}: ` : '';
      return wrap(`${who}${r.text || ''}`, w - 2).map((l) => `  ${paint(l, 'ink3')}`);
    }

    case 'turn-end-ok':
    case 'turn-end-fail': {
      const ok = r.kind === 'turn-end-ok';
      const m = r.meta || {};
      const bits = [];
      if (m.by) bits.push(`by ${m.by}`);
      if (m.firstTokenMs != null) bits.push(`first token ${m.firstTokenMs}ms`);
      if (m.durationMs != null) bits.push(`${Math.round(m.durationMs)}ms`);
      const label = ok ? 'turn completed · ok' : 'turn failed';
      const line = paint(`— ${label}`, ok ? 'up' : 'down', { bold: true }) + (bits.length ? paint(`  ${bits.join(' · ')}`, 'ink3') : '');
      const out = [line];
      if (r.text) for (const l of wrap(r.text, w - 2)) out.push(`  ${paint(l, ok ? 'ink2' : 'down')}`);
      return out;
    }

    default:
      return wrap(r.text || '', w).map((l) => `  ${paint(l, 'ink2')}`);
  }
}

/**
 * Compose the whole frame.
 * @returns {string[]} exactly `rows` lines, each padded to `cols`.
 */
export function composeView(t, { cols, rows, scroll = 0, input = '', busy = false, model = '', notice = '', header = {} }) {
  const width = Math.max(24, cols);
  const height = Math.max(CHROME_ROWS + 1, rows);

  const body = [];
  for (const r of t.rows) for (const line of rowLines(r, width)) body.push(line);

  const bodyRows = height - CHROME_ROWS;
  const maxScroll = Math.max(0, body.length - bodyRows);
  const off = Math.min(Math.max(0, scroll), maxScroll);
  const start = Math.max(0, body.length - bodyRows - off);
  let visible = body.slice(start, start + bodyRows);
  // Trim decorated lines to the frame width (they are already wrapped).
  visible = visible.map((l) => (visibleWidth(l) > width ? truncate(l, width) : l));

  const padTop = Math.max(0, bodyRows - visible.length);
  const out = [];
  out.push(...headerLines({ cols: width, ...header }));
  for (let i = 0; i < padTop; i++) out.push('');

  const scrollMark = off > 0 ? paint(` ↑${off}`, 'gold') : '';
  if (visible.length) {
    const idx = visible.length - 1;
    visible[idx] = visible[idx] + scrollMark;
  }
  out.push(...visible);

  // Composer: rule / input / rule
  out.push(rule(width));
  const caret = paint('› ', busy ? 'gold' : 'ember', { bold: true });
  const shown = input === '' && !busy ? paint('ask JEXI anything · /help', 'ink3') : paint(input, 'ink');
  const spin = busy ? paint(' ⠿', 'gold') : '';
  out.push(truncate(`${caret}${shown}${spin}`, width));
  out.push(rule(width));

  // Status
  const left = paint(model ? `model: ${model}` : 'model: none configured', model ? 'ink3' : 'gold');
  const rightBits = [`${t.stats.tools} tools`];
  if (t.stats.toolErrors) rightBits.push(`${t.stats.toolErrors} failed`);
  if (t.stats.firstTokenMs != null) rightBits.push(`first token ${t.stats.firstTokenMs}ms`);
  if (notice) rightBits.push(notice);
  const right = paint(rightBits.join(' · '), 'ink3');
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  out.push(`${left}${' '.repeat(gap)}${right}`);

  // Guarantee the exact frame height so the writer never leaves stale rows.
  while (out.length < height) out.push('');
  return out.slice(0, height).map((l) => (visibleWidth(l) > width ? truncate(l, width) : l));
}

export default { composeView, rowLines, headerLines, CHROME_ROWS };
