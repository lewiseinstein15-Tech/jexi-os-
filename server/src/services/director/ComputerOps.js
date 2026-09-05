/**
 * B211 B3 — COMPUTER OPS: the Director lane's honest computer-use executor.
 *
 * Atlas (Computer Operations) drives the REAL virtual desktop through this
 * module. It is the same machinery the /api/desktop/coder routes serve
 * (DesktopManager + Playwright) — reused, never duplicated — behind the
 * Director's permission and telemetry rules:
 *
 *   - CAPABILITY HONESTY: the runtime provider's REAL capabilities are
 *     checked at EXECUTION time. No browser in this environment → the action
 *     is BLOCKED with the true reason and a COMPUTER_BLOCKED event. Computer
 *     use is never faked, screenshotted from cache, or invented.
 *   - OBSERVE → ACT → OBSERVE → VERIFY: every action round ends with a real
 *     observation of the page (title, visible text, numbered elements,
 *     change-hash vs before) — the employee's next decision is grounded in
 *     what the page actually shows, not what she hopes it shows.
 *   - TELEMETRY: every action and observation emits a COMPUTER_* event with
 *     the real outcome; screenshots are saved as real files (bounded).
 *
 * Provider dispatch: 'mock' → ComputerRuntime's deterministic test provider
 * (test-only, env-gated); 'remote' → the in-process desktop bridge
 * (DesktopManager); 'local' → terminal-only, browser actions honestly blocked.
 */

import { activeProvider, providerCapabilities, runtimeCall } from '../ComputerRuntime.js';
import { DesktopManager, ensureBrowser } from '../DesktopManager.js';

const dm = new DesktopManager('playwright');

/** Actions an employee may request, one per ```browser block line. */
export const BROWSER_ACTIONS = new Set(['observe', 'goto', 'click-index', 'type-index', 'click-text', 'scroll', 'press', 'back', 'forward']);

const MAX_ACTIONS_PER_ROUND = 4;
const OBSERVE_TEXT_CHARS = 1500;
const OBSERVE_ELEMENTS = 18;

export function computerCapabilities() {
  const provider = activeProvider();
  return { provider, ...providerCapabilities(provider) };
}

/**
 * Parse one browser action line into { action, arg, text }.
 * Unknown/malformed lines return null (the caller reports them honestly).
 */
export function parseBrowserLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;
  const m = raw.match(/^(observe|goto|click-index|type-index|click-text|scroll|press|back|forward)\b\s*(.*)$/i);
  if (!m) return null;
  const action = m[1].toLowerCase();
  let rest = m[2].trim();
  if (action === 'goto') {
    if (!/^https?:\/\//i.test(rest)) rest = `https://${rest.replace(/^\/+/, '')}`;
    return rest.length > 4 ? { action, url: rest.slice(0, 500) } : null;
  }
  if (action === 'click-index') {
    const n = Number.parseInt(rest, 10);
    return Number.isInteger(n) && n > 0 ? { action, index: n } : null;
  }
  if (action === 'type-index') {
    const m2 = rest.match(/^(\d+)\s+([\s\S]+)$/);
    return m2 ? { action, index: Number(m2[1]), text: m2[2].slice(0, 600) } : null;
  }
  if (action === 'click-text') return rest ? { action, text: rest.slice(0, 200) } : null;
  if (action === 'scroll') return { action, direction: /^(up|top)$/i.test(rest) ? 'up' : 'down' };
  if (action === 'press') return rest ? { action, key: rest.split(/\s+/)[0].slice(0, 20) } : null;
  return { action }; // observe | back | forward
}

/* ── observation helpers (one per provider) ─────────────────────────────── */

async function observeViaRuntime() {
  const [textR, elR, titleR] = await Promise.all([
    runtimeCall('page-text', {}).catch(() => null),
    runtimeCall('elements', {}).catch(() => null),
    runtimeCall('page-title', {}).catch(() => null),
  ]);
  const text = String((textR && textR.text) || '');
  const elements = Array.isArray(elR && elR.elements) ? elR.elements : [];
  // B225: the observed title is whatever the runtime REALLY reports. Runtimes
  // without a DOM title (android: a11y dump only) report unavailable → ''
  // honestly — never a fabricated 'Mock page'.
  const title = titleR && typeof titleR.title === 'string' && titleR.title ? titleR.title : '';
  return { title, text, elements, screenshot: null };
}

async function observeViaDesktop() {
  const text = await dm.pageText('atlas').catch(() => '');
  let elements = [];
  let title = '';
  try {
    // B212: the interactive map already carries document.title. The old code
    // fetched the page text a SECOND time and discarded it (`&& ''`), so the
    // observed title was always empty — even on a fully loaded page. Found by
    // the first live production mission (its COMPUTER_OBSERVE title was ''
    // while the page had loaded for the goto call).
    const m = await dm.interactiveMap('atlas');
    elements = m.elements || [];
    if (typeof m.title === 'string') title = m.title;
  } catch { /* page may have no interactive nodes */ }
  let screenshot = null;
  try {
    const shot = await dm.saveScreenshot('atlas');
    if (shot && shot.saved) screenshot = shot.file;
  } catch { /* screenshot is best-effort telemetry, never a claim */ }
  return { title, text: String(text || ''), elements, screenshot };
}

/**
 * Execute ONE round of browser actions (≤ MAX_ACTIONS_PER_ROUND lines).
 * @param {object} args
 * @param {string[]} args.lines raw action lines from the employee's output
 * @param {Function} args.emit (type, fields) telemetry emitter
 * @returns {Promise<{blocked: boolean, reason?: string, results: Array, observation?: object}>}
 */
export async function runBrowserRound({ lines, emit, identity }) {
  const id = identity || { agentId: 'atlas', agentName: 'Atlas' };
  const caps = computerCapabilities();

  const parsed = (Array.isArray(lines) ? lines : []).map(parseBrowserLine);
  const requests = parsed.filter(Boolean).slice(0, MAX_ACTIONS_PER_ROUND);
  const invalid = parsed.length - requests.length;

  if (!caps.browser) {
    const reason = `computer runtime "${caps.provider}" has no browser in this environment — computer use is honestly unavailable, never faked`;
    emit('COMPUTER_BLOCKED', {
      agentId: id.agentId, agentName: id.agentName, severity: 'warn',
      summary: `Browser action blocked: ${reason}.`,
      data: { provider: caps.provider, capabilities: caps },
    });
    return { blocked: true, reason, results: [] };
  }

  // B225: mock AND android act through the runtime adapter. android needs no
  // host browser — the DEVICE is the computer (am start + uiautomator + input).
  const viaRuntime = caps.provider === 'mock' || caps.provider === 'android';
  const viaDesktop = !viaRuntime;

  // B212 (found by the live production mission): the advertised provider may
  // claim a browser this host cannot actually launch — e.g. the slim deploy
  // image sets JEXI_NO_BROWSER=1, so every DesktopManager call honestly
  // fails while caps.browser still says true. Probe the REAL thing before
  // acting: one COMPUTER_BLOCKED with the true reason beats a whole round of
  // dead actions and an empty observation.
  // B225: android gets the same probe — the REAL device must be attached
  // (adb + USB debugging) before any action is attempted.
  if (caps.provider === 'android') {
    const probe = await runtimeCall('status', {}).catch(() => null);
    if (!probe || probe.unavailable) {
      const reason = `${(probe && probe.reason) || 'android device not reachable'} — computer use is honestly unavailable, never faked`;
      emit('COMPUTER_BLOCKED', {
        agentId: id.agentId, agentName: id.agentName, severity: 'warn',
        summary: `Browser action blocked: ${reason}.`,
        data: { provider: caps.provider, capabilities: caps },
      });
      return { blocked: true, reason, results: [] };
    }
  }
  if (viaDesktop) {
    const ready = await ensureBrowser();
    if (!ready.ok) {
      const reason = `${ready.error} — computer use is honestly unavailable, never faked`;
      emit('COMPUTER_BLOCKED', {
        agentId: id.agentId, agentName: id.agentName, severity: 'warn',
        summary: `Browser action blocked: ${reason}.`,
        data: { provider: caps.provider, capabilities: caps },
      });
      return { blocked: true, reason, results: [] };
    }
  }
  const results = [];
  for (const req of requests) {
    const label = describeAction(req);
    emit('COMPUTER_ACT', {
      agentId: id.agentId, agentName: id.agentName,
      summary: `${id.agentName} → ${label}`,
      data: { action: req.action, ...req },
    });
    try {
      const out = viaDesktop ? await actViaDesktop(req) : await actViaRuntime(req);
      results.push({ action: req.action, ok: out.ok !== false, summary: out.summary || label, detail: (out.detail || '').slice(0, 600) });
    } catch (e) {
      results.push({ action: req.action, ok: false, summary: `${label} failed`, detail: String(e && e.message || e).slice(0, 300) });
    }
  }
  if (invalid > 0) {
    results.push({ action: '(unparseable)', ok: false, summary: `${invalid} unparseable browser line(s) skipped`, detail: 'Lines must be like: goto <url> · click-index <n> · type-index <n> <text> · click-text <text> · scroll <up|down> · press <key> · back · forward · observe' });
  }

  // OBSERVE — the loop's grounding step: real page state after the actions.
  let observation = null;
  try {
    const obs = viaDesktop ? await observeViaDesktop() : await observeViaRuntime();
    observation = {
      title: String(obs.title || '').slice(0, 120),
      textChars: obs.text.length,
      textSnippet: obs.text.slice(0, OBSERVE_TEXT_CHARS),
      elements: obs.elements.slice(0, OBSERVE_ELEMENTS),
      elementCount: obs.elements.length,
      screenshot: obs.screenshot,
    };
    emit('COMPUTER_OBSERVE', {
      agentId: id.agentId, agentName: id.agentName,
      summary: `Observed the page: ${observation.elementCount} interactive element(s), ${observation.textChars} chars of text${observation.screenshot ? ` — screenshot saved (${observation.screenshot})` : ''}.`,
      data: { title: observation.title, elementCount: observation.elementCount, textChars: observation.textChars, screenshot: observation.screenshot },
    });
  } catch (e) {
    observation = { error: String(e && e.message || e).slice(0, 200) };
  }

  return { blocked: false, results, observation };
}

function describeAction(req) {
  switch (req.action) {
    case 'goto': return `open ${req.url}`;
    case 'click-index': return `click element #${req.index}`;
    case 'type-index': return `type into element #${req.index}`;
    case 'click-text': return `click "${req.text}"`;
    case 'type': return `type ${String(req.text || '').length} chars`;
    case 'scroll': return `scroll ${req.direction}`;
    case 'press': return `press ${req.key}`;
    default: return req.action;
  }
}

async function actViaDesktop(req) {
  switch (req.action) {
    case 'observe': return { ok: true, summary: 'observed' };
    case 'goto': {
      const r = await dm.goto('atlas', req.url);
      return { ok: true, summary: `opened ${r.url}`, detail: `title: ${r.title}` };
    }
    case 'click-index': { await dm.clickIndex('atlas', req.index); return { ok: true, summary: `clicked #${req.index}` }; }
    case 'type-index': { await dm.typeIndex('atlas', req.index, req.text); return { ok: true, summary: `typed into #${req.index}` }; }
    case 'click-text': { const ok = await dm.clickText('atlas', req.text); return { ok: ok !== false, summary: ok === false ? `"${req.text}" not found` : `clicked "${req.text}"` }; }
    case 'scroll': { await dm.scroll('atlas', req.direction); return { ok: true, summary: `scrolled ${req.direction}` }; }
    case 'press': { await dm.pressKey('atlas', req.key); return { ok: true, summary: `pressed ${req.key}` }; }
    case 'back': { await dm.back('atlas'); return { ok: true, summary: 'went back' }; }
    case 'forward': { await dm.forward('atlas'); return { ok: true, summary: 'went forward' }; }
    default: return { ok: false, summary: `unknown action ${req.action}` };
  }
}

async function actViaRuntime(req) {
  switch (req.action) {
    case 'observe': return { ok: true, summary: 'observed' };
    case 'goto': { await runtimeCall('goto', { url: req.url }); return { ok: true, summary: `opened ${req.url}` }; }
    case 'click-index': { await runtimeCall('click-index', { index: req.index }); return { ok: true, summary: `clicked #${req.index}` }; }
    case 'type-index': { await runtimeCall('type-index', { index: req.index, text: req.text }); return { ok: true, summary: `typed into #${req.index}` }; }
    case 'click-text': { const r = await runtimeCall('click-text', { text: req.text }); return { ok: r !== false, summary: `clicked "${req.text}"` }; }
    // B225: these pass through to the runtime for real (android executes
    // swipe/keyevent; mock answers ok as before; local honestly declines).
    case 'scroll': { const r = await runtimeCall('scroll', { direction: req.direction }).catch(() => null); return { ok: !!r && r.ok !== false && !r.unavailable, summary: `scrolled ${req.direction}` }; }
    case 'press': { const r = await runtimeCall('press', { key: req.key }).catch(() => null); return { ok: !!r && r.ok !== false && !r.unavailable, summary: `pressed ${req.key}` }; }
    case 'back': case 'forward': { const r = await runtimeCall(req.action, {}).catch(() => null); return { ok: !!r && r.ok !== false && !r.unavailable, summary: req.action }; }
    default: return { ok: false, summary: `unknown action ${req.action}` };
  }
}

/** Prompt-block for employee briefs (only when the tool is staffed + permitted). */
export function browserToolInstructions() {
  return `

You can DRIVE THE REAL BROWSER in the virtual desktop: put each action ALONE in a fenced block with \`browser\` as the info string:

\`\`\`browser
goto https://example.com
\`\`\`

Actions (one per block): observe · goto <url> · click-index <n> · type-index <n> <text> · click-text <text> · scroll <up|down> · press <key> · back · forward.
After your actions run, the REAL page state comes back to you (title, visible text, numbered interactive elements) — decide your next step from what the page ACTUALLY shows.
CRITICAL HONESTY RULE: never claim you opened, clicked, or read anything unless it arrived in BROWSER RESULTS. If the browser is unavailable in this environment, say exactly that — never invent pages, content, or screenshots.`;
}
