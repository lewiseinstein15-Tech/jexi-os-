import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { WORKSPACE_DIR } from '../config.js';

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

const WELCOME_PAGE = `data:text/html,<html><body style="background:#050505;color:#00FF9D;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center">
<h1>🖥️ JEXI OS VIRTUAL DESKTOP</h1>
<p style="color:#888">Browser engine online — JEXI's eyes.</p>
<p style="color:#555;font-size:12px">Ask JEXI to open a link, research a topic, or build something.<br/>This window shows exactly what JEXI is seeing.</p>
</div></body></html>`;

export async function ensureBrowser() {
  if (browserReady) return { ok: true };
  if (browserError) return { ok: false, error: browserError };
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'],
    });
    page = await browser.newPage({ viewport: { width: 1280, height: 720 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
    await page.goto(WELCOME_PAGE, { timeout: 15000 }).catch(() => {});
    browserReady = true;
    return { ok: true };
  } catch (e) {
    browserError = `Browser unavailable: ${e.message}. JEXI will fall back to server-side reading.`;
    console.error(`[Desktop] ${browserError}`);
    return { ok: false, error: browserError };
  }
}

export function browserStatus() {
  return { ready: browserReady, error: browserError };
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
      // Still give the viewer something to render
      return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#050505"/><text x="640" y="360" fill="#00FF9D" font-family="monospace" font-size="22" text-anchor="middle">Virtual Desktop offline — ${browserError || ''}</text></svg>`).toString('base64')}`;
    }
    const shot = await page.screenshot({ type: 'png' });
    return `data:image/png;base64,${shot.toString('base64')}`;
  }

  async extractText(agentId) {
    return await this.pageText(agentId);
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
