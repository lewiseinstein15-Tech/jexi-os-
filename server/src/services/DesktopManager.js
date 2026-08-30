import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { WORKSPACE_DIR, DATA_DIR } from '../config.js';

const SCREENSHOTS_DIR = path.join(DATA_DIR, 'screenshots');

const execAsync = promisify(exec);

// Keep Chromium inside the app's own node_modules when the default $HOME cache
// wouldn't survive a build->runtime handoff (Render, serverless hosts wipe the
// home cache between build and run). Respects an explicit PLAYWRIGHT_BROWSERS_PATH.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  const defaultCache = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!fs.existsSync(defaultCache)) process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

let browser = null;
let page = null;
let browserReady = false;
let browserError = null;
let launching = null;      // in-flight launch promise (share one launch among callers)
let lastRelaunchAt = 0;    // cooldown so a broken host isn't hammered with relaunches
const RELAUNCH_COOLDOWN_MS = 30000;

const WELCOME_HTML = `<html><body style="background:#050505;color:#00FF9D;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center">
<h1>🖥️ JEXI OS VIRTUAL DESKTOP</h1>
<p style="color:#888">Browser engine online — JEXI's eyes.</p>
<p style="color:#555;font-size:12px">Ask JEXI to open a link, research a topic, or build something.<br/>This window shows exactly what JEXI is seeing.</p>
</div></body></html>`;

/** True only if the browser AND page are genuinely alive right now. */
function isAlive() {
  try {
    return Boolean(browserReady && browser && typeof browser.isConnected === 'function' && browser.isConnected() && page && !page.isClosed());
  } catch {
    return false;
  }
}

async function resetBrowser() {
  try { await page?.close(); } catch {}
  try { await browser?.close(); } catch {}
  page = null;
  browser = null;
  browserReady = false;
}

export async function ensureBrowser() {
  // B178 — small-RAM hosts (Koyeb free 512MB): Chromium can OOM the whole
  // brain. Set JEXI_NO_BROWSER=1 to disable it there — search, research,
  // /watch and vision all work without a browser; only remote browser
  // control is unavailable (honest error, never a crash).
  if (process.env.JEXI_NO_BROWSER === '1') {
    return { ok: false, error: 'Browser control disabled on this host (JEXI_NO_BROWSER=1) — search, research and video analysis still work.' };
  }
  // Fast path: browser is genuinely alive.
  if (isAlive()) return { ok: true };

  // Share one launch among concurrent callers.
  if (launching) return launching;

  launching = (async () => {
    // Clear any dead references before relaunching.
    if (!browserReady || !browser) {
      try { await browser?.close(); } catch {}
      browser = null;
      page = null;
    }
    browserError = null;
    try {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--no-zygote',
          '--disable-background-networking',
          '--disable-component-update',
        ],
      });
      page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      page.setDefaultTimeout(20000);

      // Self-healing: if Chromium dies for ANY reason, drop the ready flag so
      // the next call relaunches instead of throwing forever (the old white-screen bug).
      browser.on('disconnected', () => {
        browserReady = false;
        browser = null;
        page = null;
        console.error('[Desktop] Chromium disconnected — will relaunch on next use.');
      });
      page.on('crash', () => {
        browserReady = false;
        console.error('[Desktop] Tab crashed — will relaunch on next use.');
      });

      // Bulletproof welcome screen: setContent never fails on encoding/URL issues
      // (the old data: URL navigation silently left a BLANK WHITE page).
      await page.setContent(WELCOME_HTML, { waitUntil: 'load' }).catch(() => {});
      browserReady = true;
      return { ok: true };
    } catch (e) {
      browserError = `Browser unavailable: ${e.message}. JEXI will fall back to server-side reading.`;
      console.error(`[Desktop] ${browserError}`);
      try { await browser?.close(); } catch {}
      browser = null;
      page = null;
      return { ok: false, error: browserError };
    } finally {
      launching = null;
    }
  })();

  return launching;
}

/** Force a clean restart of JEXI's eyes (used by the viewer's "Restart eyes" button). */
export async function restartBrowser() {
  await resetBrowser();
  return ensureBrowser();
}

export function browserStatus() {
  if (isAlive()) return { ready: true, error: browserError };
  return { ready: false, error: browserError || (browserReady ? 'Browser disconnected — restarting on next use.' : null) };
}

/** Retry a screenshot with one self-heal: if the tab died, relaunch (cooldown-guarded). */
async function screenshotWithHeal() {
  try {
    const shot = await page.screenshot({ type: 'jpeg', quality: 70 });
    return `data:image/jpeg;base64,${shot.toString('base64')}`;
  } catch (e) {
    const now = Date.now();
    if (now - lastRelaunchAt < RELAUNCH_COOLDOWN_MS) {
      throw new Error(`Browser error: ${e.message}`);
    }
    lastRelaunchAt = now;
    console.error(`[Desktop] screenshot failed (${e.message}) — relaunching browser…`);
    browserReady = false;
    try { await page?.close(); } catch {}
    page = null;
    const retry = await ensureBrowser();
    if (!retry.ok) throw new Error(retry.error);
    const shot = await page.screenshot({ type: 'jpeg', quality: 70 });
    return `data:image/jpeg;base64,${shot.toString('base64')}`;
  }
}

/**
 * The virtual desktop: a real Chromium browser (JEXI's eyes) + a real
 * terminal (her hands) that runs inside the workspace directory.
 */
export class DesktopManager {
  constructor(runtime = 'playwright') {
    this.runtime = runtime;
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  }

  /* ---------------- TERMINAL (her hands) ---------------- */

  async executeCommand(agentId, command) {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: WORKSPACE_DIR,
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, DISPLAY: ':1' },
      });
      return `${stdout || ''}${stderr || ''}`.trim();
    } catch (e) {
      return (e.stdout || e.stderr || e.message || '').toString();
    }
  }

  async writeFile(agentId, filename, content) {
    const safeName = String(filename || 'file.txt').replace(/\.\./g, '_');
    const filePath = path.join(WORKSPACE_DIR, safeName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return `Wrote ${safeName} (${content.length} chars)`;
  }

  /* ---------------- BROWSER (her eyes) ---------------- */

  async goto(agentId, url) {
    const ready = await ensureBrowser();
    if (!ready.ok) throw new Error(ready.error);
    // Phase 2 — SSRF guard on browser navigation: block private / link-local /
    // cloud-metadata targets, but KEEP loopback allowed (JEXI legitimately
    // previews locally-built apps at http://localhost). Localhost-only dev
    // servers cannot be reached by remote attackers anyway — the threat is
    // the LLM being tricked into navigating to 169.254.169.254 or internal
    // ranges. Set DESKTOP_ALLOW_PRIVATE=1 to lift the block entirely.
    const allowPrivate = ['1', 'true', 'yes'].includes(String(process.env.DESKTOP_ALLOW_PRIVATE || '').toLowerCase());
    if (!allowPrivate) {
      try {
        const u = new URL(url);
        const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
        if (!isLoopback) {
          const blocked = await import('./Security.js').then((m) => m.isSSRF(url));
          if (blocked) throw new Error(`Security blocked (SSRF): ${String(url).slice(0, 120)}`);
        }
      } catch (e) {
        if (e.message && /Security blocked/.test(e.message)) throw e;
        throw new Error(`Invalid URL: ${String(url).slice(0, 120)}`);
      }
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1200));
    return { url: page.url(), title: await page.title() };
  }

  async pageText(agentId) {
    const ready = await ensureBrowser();
    if (!ready.ok) throw new Error(ready.error);
    return await page.evaluate(() => document.body ? document.body.innerText : '');
  }

  async links(agentId) {
    const ready = await ensureBrowser();
    if (!ready.ok) return [];
    return await page.evaluate(() =>
      Array.from(document.querySelectorAll('a')).map(a => ({ text: (a.innerText || a.title || '').trim().slice(0, 120), href: a.href })).filter(l => l.text && l.href).slice(0, 80)
    );
  }

  async takeScreenshot(agentId) {
    const ready = await ensureBrowser();
    if (!ready.ok) {
      return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#050505"/><text x="640" y="360" fill="#00FF9D" font-family="monospace" font-size="22" text-anchor="middle">Virtual Desktop offline — ${browserError || ''}</text></svg>`).toString('base64')}`;
    }
    return screenshotWithHeal();
  }

  /** Persist the current view as a JPEG in DATA_DIR/screenshots and return the file path. */
  async saveScreenshot(agentId) {
    const ready = await ensureBrowser();
    if (!ready.ok) return { saved: false, error: ready.error };
    try {
      const shot = await screenshotWithHeal();
      const b64 = String(shot).replace(/^data:image\/jpeg;base64,/, '');
      fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
      const name = `shot-${Date.now()}.jpg`;
      fs.writeFileSync(path.join(SCREENSHOTS_DIR, name), Buffer.from(b64, 'base64'));
      return { saved: true, file: name, path: path.join(SCREENSHOTS_DIR, name) };
    } catch (e) {
      return { saved: false, error: (e && e.message) || String(e) };
    }
  }

  /** Saved screenshot gallery (newest first). */
  listScreenshots(agentId, limit = 12) {
    try {
      if (!fs.existsSync(SCREENSHOTS_DIR)) return [];
      return fs.readdirSync(SCREENSHOTS_DIR)
        .filter((f) => /^shot-.*\.jpg$/.test(f))
        .sort((a, b) => (a < b ? 1 : -1))
        .slice(0, limit)
        .map((f) => {
          const st = fs.statSync(path.join(SCREENSHOTS_DIR, f));
          return { file: f, size: st.size, at: st.mtimeMs };
        });
    } catch (e) {
      return [];
    }
  }

  /**
   * UI verification (stage 19): capture a lightweight page snapshot, then after
   * an action, call verifyChange(before) to honestly report whether the page
   * actually changed — URL, title, element count, or body text hash.
   */
  async snapshot(agentId) {
    const ready = await ensureBrowser();
    if (!ready.ok) throw new Error(ready.error);
    const url = page.url();
    const title = await page.title();
    const elements = await this.interactiveMap(agentId);
    const text = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 4000) : '');
    return {
      url, title,
      elementCount: elements.elements ? elements.elements.length : 0,
      textHash: hashText(text),
      textLength: text.length,
      at: Date.now(),
    };
  }

  /** Compare a before-snapshot to the current page. Pure, testable. */
  async verifyChange(agentId, before) {
    const after = await this.snapshot(agentId);
    return diffSnapshots(before, after);
  }

  async extractText(agentId) {
    return await this.pageText(agentId);
  }

  /**
   * Numbered element indexing (browser-use / WebVoyager / Set-of-Mark pattern):
   * injects data-agent-id markers into visible interactive elements and returns
   * an indexed map the LLM can target by number — far more reliable than pixel
   * coordinates or guessing at text. This is JEXI's real "eyes" for the browser.
   */
  async interactiveMap(agentId) {
    const ready = await ensureBrowser();
    if (!ready.ok) throw new Error(ready.error);
    return await page.evaluate(() => {
      const selector = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [tabindex]:not([tabindex="-1"]), summary';
      const all = Array.from(document.querySelectorAll(selector));
      let idx = 0;
      const elements = [];
      for (const el of all) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        el.setAttribute('data-agent-id', String(idx));
        const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        if (!text && el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA') continue;
        elements.push({
          id: idx,
          tag: el.tagName.toLowerCase(),
          text,
          type: el.getAttribute('type') || '',
          href: el.tagName === 'A' ? (el.href || '').slice(0, 160) : '',
          placeholder: el.getAttribute('placeholder') || '',
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
        });
        idx++;
      }
      return {
        url: location.href,
        title: document.title,
        elements: elements.slice(0, 60),
      };
    });
  }

  /** Click the interactive element with the given index (SPA-healing: re-indexes and retries). */
  async clickIndex(agentId, index) {
    const ready = await ensureBrowser();
    if (!ready.ok) throw new Error(ready.error);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const el = page.locator(`[data-agent-id="${index}"]`).first();
        await el.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
        await el.click({ timeout: 8000 });
        await new Promise(r => setTimeout(r, 1200));
        return { ok: true, index };
      } catch (e) {
        if (attempt === 0) {
          // SPA re-render may have wiped the markers — re-inject and retry.
          await this.interactiveMap(agentId);
          continue;
        }
        // Last resort: click the element's recorded center coordinates.
        try {
          const map = await this.interactiveMap(agentId);
          const el = map.elements.find(elm => elm.id === Number(index));
          if (el) {
            await page.mouse.click(el.x, el.y);
            await new Promise(r => setTimeout(r, 1200));
            return { ok: true, index, via: 'coords' };
          }
        } catch {}
        throw new Error(`Element [${index}] not clickable after re-index`);
      }
    }
  }

  /** Focus element [index] and type text into it (fills inputs, falls back to keystrokes). */
  async typeIndex(agentId, index, text) {
    const ready = await ensureBrowser();
    if (!ready.ok) throw new Error(ready.error);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const el = page.locator(`[data-agent-id="${index}"]`).first();
        await el.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
        await el.click({ timeout: 8000 });
        await el.fill(text, { timeout: 6000 }).catch(async () => { await page.keyboard.type(text, { delay: 25 }); });
        await new Promise(r => setTimeout(r, 400));
        return { ok: true, index };
      } catch (e) {
        if (attempt === 0) { await this.interactiveMap(agentId); continue; }
        throw new Error(`Element [${index}] not focusable`);
      }
    }
  }

  async click(agentId, x, y) {
    const ready = await ensureBrowser();
    if (!ready.ok) throw new Error(ready.error);
    await page.mouse.click(x, y);
    await new Promise(r => setTimeout(r, 700));
    return `Clicked ${x},${y}`;
  }

  async clickText(agentId, text) {
    const ready = await ensureBrowser();
    if (!ready.ok) throw new Error(ready.error);
    try {
      const el = page.getByText(text, { exact: false }).first();
      await el.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
      await el.click({ timeout: 8000 });
      await new Promise(r => setTimeout(r, 1500));
      return true;
    } catch (e) {
      // Fallback: click the first <a> whose text matches
      try {
        const clicked = await page.evaluate((t) => {
          const links = Array.from(document.querySelectorAll('a,button'));
          const el = links.find(a => (a.innerText || '').toLowerCase().includes(t.toLowerCase()));
          if (el) { el.click(); return true; }
          return false;
        }, text);
        await new Promise(r => setTimeout(r, 1500));
        return clicked;
      } catch (e2) {
        throw new Error(`Could not find clickable text "${text}"`);
      }
    }
  }

  async type(agentId, text) {
    const ready = await ensureBrowser();
    if (!ready.ok) throw new Error(ready.error);
    await page.keyboard.type(text, { delay: 25 });
    await new Promise(r => setTimeout(r, 400));
    return `Typed ${text.length} chars`;
  }

  async pressKey(agentId, key) {
    const ready = await ensureBrowser();
    if (!ready.ok) throw new Error(ready.error);
    const mapped = key === 'ctrl+l' ? 'Control+l' : key === 'Page_Down' ? 'PageDown' : key === 'Page_Up' ? 'PageUp' : key === 'Return' ? 'Enter' : key === 'Escape' ? 'Escape' : key === 'Alt+F4' ? 'Alt+F4' : key;
    await page.keyboard.press(mapped).catch(async () => { await page.keyboard.press(key); });
    await new Promise(r => setTimeout(r, 500));
    return `Pressed ${key}`;
  }

  async scroll(agentId, direction = 'down') {
    const ready = await ensureBrowser();
    if (!ready.ok) throw new Error(ready.error);
    await page.evaluate((dir) => window.scrollBy(0, dir === 'up' ? -900 : 900), direction);
    await new Promise(r => setTimeout(r, 600));
    return `Scrolled ${direction}`;
  }

  async back(agentId) {
    const ready = await ensureBrowser();
    if (!ready.ok) throw new Error(ready.error);
    await page.goBack({ timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
    return { url: page.url() };
  }

  async forward(agentId) {
    const ready = await ensureBrowser();
    if (!ready.ok) throw new Error(ready.error);
    await page.goForward({ timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
    return { url: page.url() };
  }
}

/** Cheap deterministic hash of page text (used for change detection). */
export function hashText(text) {
  let h = 5381;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Pure snapshot diff — the heart of UI verification. Compares two page
 * snapshots and reports WHICH signals changed (url / title / elements / text)
 * and a verdict. `changed:false` means the action had no observable effect.
 */
export function diffSnapshots(before, after) {
  const b = before || {};
  const a = after || {};
  const signals = [];
  if (b.url !== a.url) signals.push('url');
  if (b.title !== a.title) signals.push('title');
  if (b.elementCount !== a.elementCount) signals.push('elements');
  if (b.textHash !== a.textHash) signals.push('text');
  return {
    changed: signals.length > 0,
    signals,
    before: { url: b.url, title: b.title, elementCount: b.elementCount, textLength: b.textLength },
    after: { url: a.url, title: a.title, elementCount: a.elementCount, textLength: a.textLength },
  };
}
