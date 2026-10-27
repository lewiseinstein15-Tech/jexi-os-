/**
 * JEXI TUI — terminal primitives (zero deps).
 *
 * Colors come from the console's real theme tokens (jexi-theme.css) so the
 * terminal and the web console agree on what a tool card or an approval row
 * looks like. Everything here is pure: no I/O, and TERM/COLORTERM are read
 * through functions so tests can override them.
 */

const NO_COLOR = () => !!process.env.NO_COLOR;

/** Truecolor when COLORTERM says so; 256 otherwise; mono when NO_COLOR. */
export function colorMode() {
  if (NO_COLOR()) return 'none';
  const ct = String(process.env.COLORTERM || '').toLowerCase();
  if (ct === 'truecolor' || ct === '24bit') return 'truecolor';
  const term = String(process.env.TERM || '');
  if (/256color/.test(term)) return '256';
  return 'none';
}

/** Real console tokens: interfaces/ui/web/console/styles/jexi-theme.css */
export const TOKENS = {
  ink: '#f3eee6',
  ink2: '#a99f90',
  ink3: '#7a7163',
  ember: '#ff7a3d',
  peach: '#ffb88c',
  coral: '#ff6b5e',
  gold: '#e5b567',
  up: '#4cc38a',
  down: '#ff5d5d',
  rule: '#3a342c',
};

const RGB = {};
for (const [name, hex] of Object.entries(TOKENS)) {
  RGB[name] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

const XTERM = {
  ink: 230, ink2: 145, ink3: 101, ember: 209, peach: 216,
  coral: 203, gold: 180, up: 79, down: 203, rule: 238,
};

const SGR = { reset: 0, bold: 1, dim: 2, italic: 3, underline: 4, inverse: 7 };

/** Apply a token color plus optional attributes. */
export function paint(text, token, opts = {}) {
  const mode = colorMode();
  const s = String(text);
  const attrs = !!(opts.bold || opts.dim || opts.italic || opts.underline || opts.inverse);
  if (mode === 'none' && !attrs) return s;
  const codes = [];
  for (const key of ['bold', 'dim', 'italic', 'underline', 'inverse']) {
    if (opts[key]) codes.push(SGR[key]);
  }
  if (token && mode !== 'none') codes.push(opts.bg ? bgCode(token, mode) : fgCode(token, mode));
  if (!codes.length) return s;
  return `\x1b[${codes.join(';')}m${s}\x1b[0m`;
}

function fgCode(token, mode) {
  const rgb = RGB[token];
  if (!rgb) return 0;
  if (mode === 'truecolor') return `38;2;${rgb[0]};${rgb[1]};${rgb[2]}`;
  return `38;5;${XTERM[token] ?? 7}`;
}

function bgCode(token, mode) {
  const rgb = RGB[token];
  if (!rgb) return 0;
  if (mode === 'truecolor') return `48;2;${rgb[0]};${rgb[1]};${rgb[2]}`;
  return `48;5;${XTERM[token] ?? 7}`;
}

/** Strip SGR sequences — used for width math and for the frame writer. */
export function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}]/u;

function charWidth(cp) {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp >= 0x0300 && cp <= 0x036f) return 0; // combining marks
  return WIDE.test(String.fromCodePoint(cp)) ? 2 : 1;
}

/** Visible width, ignoring SGR and counting wide chars as 2. */
export function visibleWidth(s) {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch.codePointAt(0));
  return w;
}

/**
 * Wrap text to `width` visible columns. Preserves explicit newlines, breaks
 * on spaces when possible, and hard-splits tokens longer than the line
 * (paths, JSON) rather than overflowing the frame.
 */
export function wrap(text, width) {
  const w = Math.max(1, Math.floor(width));
  const out = [];
  for (const rawLine of String(text).split('\n')) {
    if (rawLine === '') { out.push(''); continue; }
    let line = '';
    let lineW = 0;
    for (const word of rawLine.split(' ')) {
      const wordW = visibleWidth(word);
      const sep = lineW === 0 ? 0 : 1;
      if (lineW + sep + wordW <= w) {
        line += (lineW === 0 ? '' : ' ') + word;
        lineW += sep + wordW;
        continue;
      }
      if (lineW > 0) { out.push(line); line = ''; lineW = 0; }
      if (wordW <= w) { line = word; lineW = wordW; continue; }
      let chunk = '';
      let chunkW = 0;
      for (const ch of word) {
        const cw = charWidth(ch.codePointAt(0));
        if (chunkW + cw > w) { out.push(chunk); chunk = ''; chunkW = 0; }
        chunk += ch; chunkW += cw;
      }
      line = chunk; lineW = chunkW;
    }
    out.push(line);
  }
  return out;
}

/** Truncate to a visible width with an ellipsis, never splitting a wide char. */
export function truncate(text, width) {
  const w = Math.max(0, Math.floor(width));
  const s = String(text);
  if (visibleWidth(s) <= w) return s;
  if (w <= 1) return w === 1 ? '…' : '';
  let out = '';
  let used = 0;
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0));
    if (used + cw > w - 1) break;
    out += ch; used += cw;
  }
  return out + '…';
}

/** Pad to exactly `width` visible columns (truncating when needed). */
export function pad(text, width) {
  const t = truncate(text, width);
  return t + ' '.repeat(Math.max(0, width - visibleWidth(t)));
}

/** One-line summary of a value for tool cards. */
export function oneLine(s, max = 200) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export default { paint, stripAnsi, visibleWidth, wrap, truncate, pad, oneLine, TOKENS, colorMode };
