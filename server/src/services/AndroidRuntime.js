/**
 * JEXI OS — Android Runtime (B225 — Part 13, the honest way).
 *
 * A REAL computer-use provider backed by adb (Android Debug Bridge) — the
 * free, standard automation surface every Android device ships:
 *
 *   terminal   adb shell <command>            — real shell on the device
 *   browser    am start -a VIEW -d <url>      — opens the real device browser
 *              uiautomator dump               — the real accessibility tree
 *   input      input tap / text / keyevent / swipe
 *   screenshot screencap -p (via exec-out)    — real PNG bytes
 *   files      adb push
 *
 * The device IS the computer: the 512MB server needs no Chromium, no daemon,
 * no paid service — only a phone/emulator with USB debugging attached
 * (USB or `adb connect <ip>:<port>`), selected with COMPUTER_RUNTIME=android
 * (serial optional via JEXI_ANDROID_SERIAL / ANDROID_SERIAL).
 *
 * Honesty contract (same as the local/docker providers):
 *   - no adb binary        → { unavailable: true, reason: 'adb not found …' }
 *   - no device attached   → { unavailable: true, reason: 'no device …' }
 *   - screencap gives no PNG → unavailable, never a fake image
 *   - unknown endpoint     → unavailable, never a silent ok
 * Nothing is emulated here. Tests exercise this adapter through a stub adb
 * BINARY (argv-precise recorder) — production uses the real adb only.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ── adb resolution (sync — used by status endpoints) ─────────────────── */

/** Resolve the adb binary honestly: explicit env → SDK → PATH. null = absent. */
export function androidAdbPath() {
  const candidates = [];
  if (process.env.ANDROID_ADB) candidates.push(process.env.ANDROID_ADB);
  if (process.env.ANDROID_HOME) {
    candidates.push(path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb'));
    candidates.push(path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe'));
  }
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    candidates.push(path.join(dir, 'adb'));
    candidates.push(path.join(dir, 'adb.exe'));
  }
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch { /* not resolvable — try the next candidate */ }
  }
  return null;
}

/** The serial this adapter targets (env-configured; undefined = adb's default). */
function targetSerial() {
  return process.env.JEXI_ANDROID_SERIAL || process.env.ANDROID_SERIAL || null;
}

/** Run adb with an exact argv (no shell on our side — no quoting mangling). */
function adb(argv, { timeoutMs = 30000, raw = false } = {}) {
  const bin = androidAdbPath();
  if (!bin) {
    return Promise.resolve({ code: -1, stdout: Buffer.alloc(0), stderr: '', unavailable: 'adb not found (set ANDROID_ADB or ANDROID_HOME, or install Android platform-tools)' });
  }
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: -1, stdout: Buffer.alloc(0), stderr: String(e && e.message || e), unavailable: `adb failed to start: ${String(e && e.message || e).slice(0, 120)}` });
      return;
    }
    const out = [];
    const err = [];
    let settled = false;
    const done = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: raw ? Buffer.concat(out) : Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      done(-2);
    }, timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => { clearTimeout(timer); done(-1); err.push(Buffer.from(String(e && e.message || e))); });
    child.on('close', (code) => done(code == null ? -1 : code));
  });
}

/** adb with the target serial prepended (used for every device command). */
function adbDevice(argv, opts) {
  const serial = targetSerial();
  return adb(serial ? ['-s', serial, ...argv] : argv, opts);
}

/* ── device presence (the honest gate — checked before every claim) ────── */

async function connectedDevice() {
  const res = await adb(['devices'], { timeoutMs: 10000 }); // serial-less: lists all
  if (res.unavailable) return { unavailable: res.unavailable };
  const lines = String(res.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const attached = [];
  for (const l of lines) {
    const m = l.match(/^(\S+)\s+(device|offline|unauthorized)$/);
    if (m) attached.push({ serial: m[1], state: m[2] });
  }
  const ready = attached.filter((d) => d.state === 'device');
  if (!ready.length) {
    const why = attached.length
      ? `device(s) present but not ready: ${attached.map((d) => `${d.serial} (${d.state})`).join(', ')} — accept the USB-debugging prompt on the device`
      : 'no device attached (connect one with USB debugging, or `adb connect <ip>:<port>`)';
    return { unavailable: `no Android device ready — ${why}` };
  }
  const serial = targetSerial();
  const chosen = serial ? ready.find((d) => d.serial === serial) : ready[0];
  if (!chosen) return { unavailable: `JEXI_ANDROID_SERIAL=${serial} is not among the attached devices (${ready.map((d) => d.serial).join(', ')})` };
  return { device: chosen.serial };
}

/* ── device-shell quoting (adb joins args into ONE device-shell string) ── */

/** Quote a value for the device shell: single quotes, '\'' for embedded. */
function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Escape text for `input text`: spaces→%s (adb reality — `input text` takes
 * no literal spaces), single-quoted so the device shell expands nothing.
 * adb's input cannot type single quotes — they are dropped, documented here.
 */
function inputTextArg(text) {
  const safe = String(text)
    .replace(/[\r\n]+/g, ' ')
    .replace(/'/g, '')
    .replace(/ /g, '%s');
  return `'${safe}'`;
}

/** Key names → Android keyevent codes (the ones adb can really send). */
const KEY_EVENTS = { ENTER: 66, TAB: 61, BACK: 4, HOME: 3, DELETE: 67, ESC: 111, SPACE: 62, UP: 19, DOWN: 20, LEFT: 21, RIGHT: 22 };

/* ── accessibility-tree parsing (uiautomator dump) ────────────────────── */

function parseAttrValue(nodeSrc, name) {
  const m = nodeSrc.match(new RegExp(`\\b${name}="((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return '';
  // uiautomator escapes: \" for quote, \\ for backslash, \n etc.
  return m[1].replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseBounds(nodeSrc) {
  const m = nodeSrc.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  const [x1, y1, x2, y2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (x2 <= x1 || y2 <= y1) return null; // zero-area nodes are not visible
  return {
    x1, y1, x2, y2,
    cx: Math.round((x1 + x2) / 2),
    cy: Math.round((y1 + y2) / 2),
  };
}

/** Parse a uiautomator XML dump into numbered, bounds-carrying elements. */
export function parseUiDump(xml) {
  const src = String(xml || '');
  const nodes = src.match(/<node\s+[^>]*?\/?>/g) || [];
  const elements = [];
  for (const n of nodes) {
    const text = parseAttrValue(n, 'text');
    const desc = parseAttrValue(n, 'content-desc');
    const label = text || desc; // only elements with a visible label are actionable targets
    if (!label) continue;
    const bounds = parseBounds(n);
    if (!bounds) continue;
    const clickable = parseAttrValue(n, 'clickable') === 'true';
    const cls = parseAttrValue(n, 'class');
    const tag = /EditText/.test(cls) ? 'input' : (clickable ? 'button' : 'text'); // editable fields stay inputs — clickability never retypes them
    elements.push({
      id: elements.length + 1,
      tag,
      text: label,
      href: '', // no URLs in the a11y tree — honest empty, never guessed
      resource: parseAttrValue(n, 'resource-id') || null,
      clickable,
      bounds,
    });
  }
  return elements;
}

const DUMP_PATH = '/sdcard/jexi-dump.xml';

async function dumpElements() {
  const dump = await adbDevice(['shell', `uiautomator dump ${shQuote(DUMP_PATH)}`], { timeoutMs: 20000 });
  if (dump.unavailable) return { unavailable: dump.unavailable };
  if (dump.code !== 0) return { unavailable: `uiautomator dump failed: ${String(dump.stderr || '').slice(0, 120) || 'nonzero exit'}` };
  const cat = await adbDevice(['shell', `cat ${shQuote(DUMP_PATH)}`], { timeoutMs: 15000 });
  if (cat.unavailable) return { unavailable: cat.unavailable };
  const xml = String(cat.stdout || '');
  if (!/<node/.test(xml)) return { unavailable: 'uiautomator dump produced no node tree (the screen may be secure or not yet drawn)' };
  return { elements: parseUiDump(xml) };
}

/* ── the provider ──────────────────────────────────────────────────────── */

export class AndroidRuntime {
  async call(endpoint, payload = {}) {
    const gate = await connectedDevice();
    if (gate.unavailable) return { unavailable: true, reason: `android provider: ${gate.unavailable}` };

    switch (endpoint) {
      case 'status':
        return { ok: true, provider: 'android', device: gate.device, adb: androidAdbPath() };

      case 'execute': {
        const command = String(payload.command || '').slice(0, 4000);
        if (!command) return { ok: false, reason: 'empty command' };
        const res = await adbDevice(['shell', command], { timeoutMs: Math.min(Number(payload.timeout) || 30000, 120000) });
        if (res.unavailable) return { unavailable: true, reason: `android provider: ${res.unavailable}` };
        return { output: String(res.stdout || '').slice(0, 6000), success: res.code === 0, exitCode: res.code, stderr: String(res.stderr || '').slice(0, 500) };
      }

      case 'goto': {
        const url = String(payload.url || '').slice(0, 500);
        if (!/^https?:\/\//i.test(url)) return { ok: false, reason: `refusing non-http url: ${url.slice(0, 60)}` };
        const res = await adbDevice(['shell', `am start -a android.intent.action.VIEW -d ${shQuote(url)}`]);
        if (res.unavailable) return { unavailable: true, reason: `android provider: ${res.unavailable}` };
        return { ok: res.code === 0, opened: url, output: String(res.stdout || '').slice(0, 300) };
      }

      case 'elements': {
        const d = await dumpElements();
        if (d.unavailable) return { unavailable: true, reason: `android provider: ${d.unavailable}` };
        return { elements: d.elements.map(({ id, tag, text, href, resource, bounds }) => ({ id, tag, text, href, resource, bounds: `[${bounds.x1},${bounds.y1}][${bounds.x2},${bounds.y2}]` })) };
      }

      case 'page-text': {
        const d = await dumpElements();
        if (d.unavailable) return { unavailable: true, reason: `android provider: ${d.unavailable}` };
        return { text: d.elements.map((e) => e.text).join('\n').slice(0, 6000) };
      }

      case 'page-title':
        // The a11y tree has no DOM title. Honest absence — never a guessed one.
        return { unavailable: true, reason: 'android provider: the accessibility dump has no page title — use page-text' };

      case 'click-index':
      case 'click-text': {
        const d = await dumpElements();
        if (d.unavailable) return { unavailable: true, reason: `android provider: ${d.unavailable}` };
        let el = null;
        if (endpoint === 'click-index') el = d.elements.find((e) => e.id === Number(payload.index));
        else {
          const needle = String(payload.text || '').toLowerCase();
          el = d.elements.find((e) => e.text.toLowerCase() === needle) || d.elements.find((e) => e.text.toLowerCase().includes(needle));
        }
        if (!el) return { ok: false, reason: `element not found: ${endpoint === 'click-index' ? `#${payload.index}` : JSON.stringify(String(payload.text || '').slice(0, 60))}` };
        const res = await adbDevice(['shell', `input tap ${el.bounds.cx} ${el.bounds.cy}`]);
        if (res.unavailable) return { unavailable: true, reason: `android provider: ${res.unavailable}` };
        return { ok: res.code === 0, tapped: `${el.bounds.cx},${el.bounds.cy}`, element: el.text };
      }

      case 'type-index': {
        const d = await dumpElements();
        if (d.unavailable) return { unavailable: true, reason: `android provider: ${d.unavailable}` };
        const el = d.elements.find((e) => e.id === Number(payload.index));
        if (!el) return { ok: false, reason: `element not found: #${payload.index}` };
        const tap = await adbDevice(['shell', `input tap ${el.bounds.cx} ${el.bounds.cy}`]);
        if (tap.unavailable) return { unavailable: true, reason: `android provider: ${tap.unavailable}` };
        const type = await adbDevice(['shell', `input text ${inputTextArg(payload.text || '')}`]);
        if (type.unavailable) return { unavailable: true, reason: `android provider: ${type.unavailable}` };
        return { ok: tap.code === 0 && type.code === 0, typed: String(payload.text || '').length };
      }

      case 'scroll': {
        const size = await adbDevice(['shell', 'wm size'], { timeoutMs: 10000 });
        const m = String(size.stdout || '').match(/(\d+)x(\d+)/);
        if (!m) return { ok: false, reason: 'could not read the screen size (wm size) for scrolling' };
        const w = Number(m[1]);
        const h = Number(m[2]);
        const cx = Math.round(w / 2);
        const y1 = Math.round(h * 0.75);
        const y2 = Math.round(h * 0.25);
        const [a, b] = payload.direction === 'up' ? [y2, y1] : [y1, y2];
        const res = await adbDevice(['shell', `input swipe ${cx} ${a} ${cx} ${b} 300`]);
        if (res.unavailable) return { unavailable: true, reason: `android provider: ${res.unavailable}` };
        return { ok: res.code === 0, direction: payload.direction === 'up' ? 'up' : 'down' };
      }

      case 'press': {
        const key = String(payload.key || '').toUpperCase();
        const code = KEY_EVENTS[key];
        if (!code) return { ok: false, reason: `no Android keyevent mapping for "${key}" (mappable: ${Object.keys(KEY_EVENTS).join(', ')})` };
        const res = await adbDevice(['shell', `input keyevent ${code}`]);
        if (res.unavailable) return { unavailable: true, reason: `android provider: ${res.unavailable}` };
        return { ok: res.code === 0, key, keyevent: code };
      }

      case 'back': {
        const res = await adbDevice(['shell', 'input keyevent 4']);
        if (res.unavailable) return { unavailable: true, reason: `android provider: ${res.unavailable}` };
        return { ok: res.code === 0, keyevent: 4 };
      }

      case 'forward':
        return { ok: false, reason: 'android provider: Android has no forward key via adb — navigate with goto or a click' };

      case 'screenshot-json': {
        const res = await adbDevice(['exec-out', 'screencap -p'], { timeoutMs: 20000, raw: true });
        if (res.unavailable) return { unavailable: true, reason: `android provider: ${res.unavailable}` };
        const buf = Buffer.isBuffer(res.stdout) ? res.stdout : Buffer.from(res.stdout || '');
        if (buf.length < 8 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
          return { unavailable: true, reason: 'android provider: screencap returned no PNG (the screen may be secure — screenshots are honestly unavailable)' };
        }
        return { image: `data:image/png;base64,${buf.toString('base64')}` };
      }

      case 'write-file': {
        const target = String(payload.path || '').slice(0, 300);
        const content = String(payload.content || '');
        if (!target || !target.startsWith('/')) return { ok: false, reason: 'android provider: write-file needs an absolute device path' };
        const tmp = path.join(os.tmpdir(), `jexi-android-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        try {
          fs.writeFileSync(tmp, content);
          const res = await adbDevice(['push', tmp, target], { timeoutMs: 30000 });
          if (res.unavailable) return { unavailable: true, reason: `android provider: ${res.unavailable}` };
          return { ok: res.code === 0, pushed: target, bytes: content.length };
        } finally {
          try { fs.unlinkSync(tmp); } catch { /* best effort */ }
        }
      }

      default:
        return { unavailable: true, reason: `android provider does not implement endpoint "${String(endpoint).slice(0, 40)}"` };
    }
  }
}
