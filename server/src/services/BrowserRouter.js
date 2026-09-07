/**
 * ARENA REBUILD — Browser Router (spec Part 17).
 *
 * ONE entry point for every browser task. Workers register here; the router
 * picks the right one, enforces the safety policy, emits observable events,
 * and fails HONESTLY when no worker can do the job. No faking, ever.
 *
 *   JEXI → Capability Router → **Browser Router** → worker
 *                                              ├─ desktop  (local Chromium via DesktopManager — real, only when a browser exists on this host)
 *                                              ├─ android  (phone browser via ADB/AndroidRuntime — real, only when a device is connected)
 *                                              └─ remote   (external browser worker — registration protocol below; none assumed)
 *
 * Worker protocol (what a worker must implement):
 *   { id, kind: 'desktop'|'android'|'remote',
 *     capabilities: ['navigate','read','act','screenshot', ...],
 *     online(): boolean,                    // cheap liveness, called per task
 *     async execute(op, params, ctx): { ok, ...result } }
 *
 * Policy (enforced BEFORE any worker runs — a prompt can never override it):
 *   - CAPTCHA / anti-bot challenges are NEVER solved or bypassed. Refused.
 *   - Browser-private storage (passwords, cookies, wallets, chrome:// internals)
 *     is NEVER read or exported. Refused.
 *   - Only http/https URLs; a reason is required for every task (auditability).
 *   - Every task emits observable events and lands in a bounded audit log.
 *
 * Permission classes used: NETWORK (browsing), EXTERNAL_SERVICE (remote
 * workers), EXECUTE (page actions). High-impact actions (payments, deletes
 * inside a page) additionally require an explicit authorized=true context —
 * the caller (kernel/mission lane) decides authorization, never a prompt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

const AUDIT_FILE = path.join(DATA_DIR, 'browser-audit.jsonl');
const MAX_AUDIT = 500;

/* ── policy ──────────────────────────────────────────────────────────────── */

const CAPTCHA_RE = /(captcha|recaptcha|hcaptcha|turnstile|challenge[- ]?page|bypass.*(bot|block)|solve.*(captcha|challenge))/i;
// Always-private: browser internals + credential stores, however phrased.
const PRIVATE_STORAGE_RE = /(chrome|edge|about):\/\/|passwords?\b|wallet|autofill|credential|keychain|login data|webdata/i;
// Cookie EXTRACTION (verb → cookie) is private; an "accept cookies" click is a
// normal page action and stays allowed.
const COOKIE_EXTRACTION_RE = /(export|read|grab|dump|steal|copy|save|extract|show|list)[^.]{0,40}\bcookies?\b|\bcookies?\b[^.]{0,30}(export|dump|steal)/i;
const HIGH_IMPACT_RE = /(pay|purchase|checkout|transfer|delete|remove|reset|sign[- ]?out|sign[- ]?in|login|submit)/i;
const URL_OK_RE = /^https?:\/\//i;

/** The safety gate. Returns null (allowed) or a refusal with the reason. */
function policyCheck(task) {
  const blob = `${task.intent || ''} ${task.url || ''} ${task.reason || ''} ${JSON.stringify(task.params || {})}`;
  if (CAPTCHA_RE.test(blob)) {
    return { ok: false, refused: true, error: 'Refused: CAPTCHA and anti-bot challenges are never solved or bypassed. A human (you) solves those — JEXI does not.' };
  }
  if (PRIVATE_STORAGE_RE.test(blob) || COOKIE_EXTRACTION_RE.test(blob)) {
    return { ok: false, refused: true, error: 'Refused: browser-private storage (passwords, cookies, wallets, browser internals) is never read or exported.' };
  }
  if (task.url && !URL_OK_RE.test(task.url)) {
    return { ok: false, refused: true, error: `Refused: only http(s) URLs are browsable — "${String(task.url).slice(0, 80)}" is not.` };
  }
  if (!task.reason || !String(task.reason).trim()) {
    return { ok: false, refused: true, error: 'Refused: every browser task must state its reason (auditability).' };
  }
  if (HIGH_IMPACT_RE.test(blob) && task.authorized !== true) {
    return { ok: false, refused: true, needsAuthorization: true, error: 'Refused: high-impact page action (payment/delete/login/submit) — needs explicit authorization from Lewis first.' };
  }
  return null;
}

/* ── audit ───────────────────────────────────────────────────────────────── */

function audit(entry) {
  try {
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    fs.appendFileSync(AUDIT_FILE, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
    // bounded: keep the newest MAX_AUDIT lines
    const lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n');
    if (lines.length > MAX_AUDIT) fs.writeFileSync(AUDIT_FILE, lines.slice(-MAX_AUDIT).join('\n') + '\n');
  } catch { /* audit is best-effort — never breaks a task */ }
}

/* ── the router ──────────────────────────────────────────────────────────── */

class BrowserRouter {
  constructor() {
    this.workers = new Map(); // id → worker
    this.onEvent = null;      // global observability hook (set by the host)
  }

  /** Register a worker (idempotent by id). Returns the worker handle. */
  registerWorker(worker) {
    if (!worker || !worker.id || typeof worker.execute !== 'function') throw new Error('BrowserRouter: a worker needs { id, execute }');
    this.workers.set(worker.id, {
      kind: worker.kind || 'remote',
      capabilities: worker.capabilities || ['navigate', 'read'],
      online: typeof worker.online === 'function' ? worker.online : () => true,
      execute: worker.execute,
      registeredAt: new Date().toISOString(),
      ...worker,
    });
    return worker.id;
  }

  unregisterWorker(id) { return this.workers.delete(id); }

  listWorkers() {
    return [...this.workers.values()].map((w) => ({
      id: w.id, kind: w.kind, capabilities: w.capabilities,
      online: (() => { try { return Boolean(w.online()); } catch { return false; } })(),
      registeredAt: w.registeredAt,
    }));
  }

  emit(event, data) {
    try { this.onEvent && this.onEvent(event, data); } catch { /* never break */ }
  }

  /** Observable, policy-gated execution. Never fakes success. */
  async runTask(task, ctx = {}) {
    const t0 = Date.now();
    const refusal = policyCheck(task);
    if (refusal) {
      audit({ op: 'refused', intent: task.intent, url: task.url || null, reason: task.reason, refusal: refusal.error.slice(0, 200) });
      this.emit('browser.refused', { intent: task.intent, error: refusal.error });
      return refusal;
    }

    const needed = task.intent === 'screenshot' ? ['screenshot']
      : task.intent === 'act' ? ['act']
        : task.intent === 'read' ? ['read'] : ['navigate'];
    const candidates = [...this.workers.values()].filter((w) => {
      try { return w.online() && needed.every((c) => w.capabilities.includes(c)); } catch { return false; }
    });

    if (!candidates.length) {
      const available = this.listWorkers();
      const error = available.length
        ? `No online browser worker with the "${needed.join('+')}" capability right now. Connected: ${available.map((w) => `${w.id} (${w.kind}${w.online ? ', online' : ', offline'}${w.online ? '' : ''})`).join(', ') || 'none'}. Nothing is faked — connect a worker or try again later.`
        : 'No browser worker is connected on this host. Browsing tasks wait honestly until one is (desktop worker turns on automatically where Chromium exists; an Android worker connects when a device is paired).';
      audit({ op: 'no-worker', intent: task.intent, url: task.url || null, reason: task.reason });
      this.emit('browser.unavailable', { intent: task.intent, error });
      return { ok: false, error };
    }

    // deterministic preference: desktop (local, fast) → android → remote
    const RANK = { desktop: 0, android: 1, remote: 2 };
    candidates.sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9));
    const worker = candidates[0];

    this.emit('browser.start', { intent: task.intent, url: task.url || null, worker: worker.id, kind: worker.kind, note: `Opening ${task.url || 'the page'} via the ${worker.kind} worker — you'll see every step.` });
    try {
      const out = await worker.execute(task.intent, { url: task.url, ...task.params }, { ...ctx, workerId: worker.id });
      const ms = Date.now() - t0;
      audit({ op: 'task', intent: task.intent, url: task.url || null, worker: worker.id, ms, ok: out ? out.ok !== false : false, reason: task.reason });
      this.emit('browser.done', { intent: task.intent, worker: worker.id, ms, ok: out ? out.ok !== false : false });
      return out && typeof out === 'object' ? out : { ok: false, error: 'worker returned an invalid result — reported honestly, not faked' };
    } catch (e) {
      const ms = Date.now() - t0;
      audit({ op: 'task-error', intent: task.intent, url: task.url || null, worker: worker.id, ms, error: String(e && e.message || e).slice(0, 200), reason: task.reason });
      this.emit('browser.error', { intent: task.intent, worker: worker.id, error: String(e && e.message || e).slice(0, 200) });
      return { ok: false, error: `Browser worker "${worker.id}" failed: ${String(e && e.message || e).slice(0, 300)}` };
    }
  }

  /** Recent audit entries (observability endpoint / UI). */
  recentAudit(n = 20) {
    try {
      if (!fs.existsSync(AUDIT_FILE)) return [];
      const lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean);
      return lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }
}

export const browserRouter = new BrowserRouter();

/* ── built-in DESKTOP worker: real Chromium via DesktopManager ──────────────
 * Registers ONLY where a browser actually exists. On small hosts
 * (JEXI_NO_BROWSER=1) or browserless sandboxes it stays absent and the
 * router reports honestly that no worker is connected. */
export async function registerDesktopWorker() {
  if (process.env.JEXI_NO_BROWSER === '1') return { ok: false, error: 'Browser control disabled on this host (JEXI_NO_BROWSER=1).' };
  try {
    const desktop = await import('./DesktopManager.js');
    const probe = await desktop.ensureBrowser();
    if (!probe || !probe.ok) return { ok: false, error: `No local browser on this host: ${probe && probe.error ? probe.error : 'probe failed'} — the router stays honest, nothing is faked.` };
    const dm = new desktop.DesktopManager('playwright'); // the real class index.js uses
    const AGENT = 'browser-router'; // a named tab/agent inside DesktopManager
    browserRouter.registerWorker({
      id: 'desktop-local',
      kind: 'desktop',
      capabilities: ['navigate', 'read', 'act', 'screenshot'],
      online: () => { try { return Boolean(desktop.browserStatus && desktop.browserStatus().ready); } catch { return false; } },
      execute: async (op, params) => {
        if (op === 'navigate' && params.url) {
          const r = await dm.goto(AGENT, params.url);
          return { ok: !r || r.ok !== false, ...(r || {}), url: params.url };
        }
        if (op === 'screenshot') {
          const shot = await dm.takeScreenshot(AGENT);
          return shot && shot.ok !== false ? { ok: true, screenshot: shot } : { ok: false, error: 'screenshot failed', detail: shot };
        }
        if (op === 'read') {
          const text = await dm.pageText(AGENT);
          return { ok: typeof text === 'string' && text.length > 0, text: String(text || '').slice(0, 20000) };
        }
        if (op === 'act') {
          const actions = Array.isArray(params.actions) ? params.actions : [];
          const out = [];
          for (const a of actions.slice(0, 10)) {
            if (a.type === 'click') out.push(await dm.clickText(AGENT, String(a.text || '')));
            else if (a.type === 'type') out.push(await dm.type(AGENT, String(a.text || '')));
            else if (a.type === 'scroll') out.push(await dm.scroll(AGENT, a.direction === 'up' ? 'up' : 'down'));
            else out.push({ ok: false, error: `unknown action ${a.type}` });
          }
          return { ok: out.every((r) => r && r.ok !== false), actions: out };
        }
        return { ok: false, error: `desktop worker: unsupported op "${op}"` };
      },
    });
    return { ok: true, worker: 'desktop-local' };
  } catch (e) {
    return { ok: false, error: `Desktop worker unavailable: ${String(e && e.message || e).slice(0, 160)}` };
  }
}

/* ── ANDROID worker protocol (spec: phone browser) ──────────────────────────
 * REAL path: a connected Android device via ADB (AndroidRuntime). The APK
 * WebView channel (JEXI driving the phone's own browser through the app) is
 * the next build — protocol: an app-side WebSocket registers here as
 * { kind:'android', capabilities:['navigate','read','act','screenshot'] }.
 * Until that build ships, this registration only succeeds for a REAL
 * adb-visible device. No mock workers, ever. */
export async function registerAndroidWorker() {
  try {
    const { AndroidRuntime } = await import('./AndroidRuntime.js');
    const rt = new AndroidRuntime();
    const status = await rt.call('status');
    if (!status || status.unavailable || !status.ok) {
      return { ok: false, error: `No Android device connected (adb) — the android browser worker stays unregistered. Honest, not faked. (${status && status.unavailable ? status.unavailable : 'status probe failed'})` };
    }
    const device = status.device || 'device';
    browserRouter.registerWorker({
      id: `android-${typeof device === 'string' ? device : 'connected'}`,
      kind: 'android',
      capabilities: ['navigate', 'read', 'act', 'screenshot'],
      online: () => true, // device presence was probed at registration; per-task failures surface honestly
      execute: async (op, params) => {
        if (op === 'navigate' && params.url) {
          const r = await rt.call('goto', { url: params.url });
          return r && !r.unavailable && r.ok ? { ok: true, opened: params.url } : { ok: false, error: (r && (r.reason || r.unavailable)) || 'android navigate failed' };
        }
        if (op === 'read') {
          const r = await rt.call('elements');
          return r && !r.unavailable ? { ok: true, elements: (r.elements || []).slice(0, 200) } : { ok: false, error: (r && (r.reason || r.unavailable)) || 'android read failed' };
        }
        if (op === 'act') {
          const actions = Array.isArray(params.actions) ? params.actions : [];
          const out = [];
          for (const a of actions.slice(0, 10)) {
            if (a.type === 'type') out.push(await rt.call('execute', { command: `input text ${String(a.text || '').replace(/[\\ '"\n]/g, '')}` }));
            else out.push({ ok: false, error: `android worker: action "${a.type}" arrives with the APK WebView build (tap/scroll need the app channel)` });
          }
          return { ok: out.every((r) => r && r.success !== false && !r.unavailable), actions: out };
        }
        if (op === 'screenshot') {
          const r = await rt.call('execute', { command: 'screencap -p /sdcard/jexi-shot.png' });
          return r && r.success && !r.unavailable ? { ok: true, note: 'screencap saved on device — pull arrives with the APK build' } : { ok: false, error: (r && (r.reason || r.unavailable)) || 'screencap failed' };
        }
        return { ok: false, error: `android worker: unsupported op "${op}"` };
      },
    });
    return { ok: true, worker: 'android' };
  } catch (e) {
    return { ok: false, error: `Android worker unavailable: ${String(e && e.message || e).slice(0, 160)}` };
  }
}

/* REMOTE workers: an external browser service registers via
 * browserRouter.registerWorker({ id, kind:'remote', capabilities, online, execute })
 * — the host wires that to an authenticated endpoint. None is assumed or
 * pretended; the router simply reports "none connected" until one is real. */
