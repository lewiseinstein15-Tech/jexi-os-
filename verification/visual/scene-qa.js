/**
 * JEXI OS — Phase 9 Scope H — 3D scene checks (built for Scope J's
 * self-contained 3D globe HTML).
 *
 * Zone: verification/visual/** (Phase 9 Scope H).
 *
 * scene.check(url, spec) drives the SAME real headless Chromium as the
 * runner (shared launchPage) and returns OBSERVATIONS — explicit
 * { what, expected, actual, pass } records, never a bare boolean.
 *
 * MISSING BROWSER → { ok:false, reason:'BROWSER_UNAVAILABLE',
 * observations: [] } — a clean skip with the schema intact, never a
 * crash and never fabricated observations.
 *
 * SPEC SCHEMA (all keys optional; observations are emitted per check):
 * {
 *   viewport?: { width, height },
 *   titleContains?: string,
 *   elements?: [{ what: string, selector: string,
 *                 expect: 'present' | 'visible' }],
 *   canvas?: {
 *     present?: boolean,          // a <canvas> exists
 *     webgl?: boolean,            // a WebGL1/2 context can be created
 *     minWidth?: number,          // canvas bounding box width  ≥ minWidth
 *     minHeight?: number,         // canvas bounding box height ≥ minHeight
 *     centerNonBlack?: boolean,   // pixel at canvas center is not near-black
 *   }
 * }
 */

import { launchPage } from './puppeteer-runner.js';
import { decodePng } from './screenshot-diff.js';

/** Frozen example of a valid scene spec — shown by probes/docs. */
export const SCENE_SPEC_EXAMPLE = Object.freeze({
  viewport: { width: 1440, height: 900 },
  titleContains: 'globe',
  elements: [
    { what: 'globe canvas', selector: 'canvas#globe', expect: 'present' },
    { what: 'status bar', selector: '#status', expect: 'visible' },
  ],
  canvas: {
    present: true,
    webgl: true,
    minWidth: 800,
    minHeight: 600,
    centerNonBlack: true,
  },
});

function obs(what, expected, actual, pass) {
  return { what, expected, actual, pass: pass === true };
}

/**
 * @param {{ defaultViewport?: {width:number,height:number}, timeoutMs?: number }} [opts]
 */
export function createSceneQA({ defaultViewport = { width: 1440, height: 900 }, timeoutMs = 30000 } = {}) {
  /**
   * Run scene checks against a page.
   * @param {string} url http(s):// or file:// URL
   * @param {object} spec see SCENE_SPEC_EXAMPLE
   * @returns {Promise<{ ok: boolean, observations: object[],
   *                     errors: string[], durationMs: number,
   *                     reason?: string, detail?: string, url?: string }>}
   */
  async function check(url, spec = {}) {
    const t0 = Date.now();
    const observations = [];
    const errors = [];
    let launched = null;
    try {
      launched = await launchPage({ viewport: spec.viewport || defaultViewport, timeoutMs });
      const { page } = launched;
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
      await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });

      if (spec.titleContains !== undefined) {
        const title = await page.title();
        observations.push(obs(
          `page title contains ${JSON.stringify(spec.titleContains)}`,
          spec.titleContains, title, String(title).includes(spec.titleContains),
        ));
      }

      for (const el of spec.elements || []) {
        if (el.expect === 'visible') {
          let visible = false;
          let actual = 'selector not found';
          try {
            const locator = page.locator(el.selector).first();
            visible = await locator.isVisible();
            actual = visible ? 'visible' : 'found but not visible';
          } catch {
            /* keep defaults */
          }
          observations.push(obs(el.what || el.selector, `visible: ${el.selector}`, actual, visible));
        } else { // default: present
          let count = 0;
          try {
            count = await page.locator(el.selector).count();
          } catch (e) {
            errors.push(`locator failed for ${el.selector}: ${e.message.split('\n')[0]}`);
          }
          observations.push(obs(el.what || el.selector, `present: ${el.selector}`, `count=${count}`, count > 0));
        }
      }

      if (spec.canvas) {
        const canvasInfo = await page.evaluate(() => {
          const c = document.querySelector('canvas');
          if (!c) return { present: false };
          const box = c.getBoundingClientRect();
          let webgl = null;
          try {
            const gl = c.getContext('webgl2') || c.getContext('webgl');
            webgl = gl ? true : false;
          } catch {
            webgl = false;
          }
          return { present: true, x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height), webgl };
        });
        if (spec.canvas.present) {
          observations.push(obs('canvas present', 'a <canvas> exists', `present=${canvasInfo.present}`, canvasInfo.present));
        }
        if (spec.canvas.webgl) {
          observations.push(obs('WebGL context creatable', 'webgl or webgl2', `webgl=${canvasInfo.webgl}`, canvasInfo.webgl === true));
        }
        if (typeof spec.canvas.minWidth === 'number') {
          observations.push(obs(
            `canvas width ≥ ${spec.canvas.minWidth}`, `≥ ${spec.canvas.minWidth}`,
            canvasInfo.width ?? 'no canvas', canvasInfo.width >= spec.canvas.minWidth,
          ));
        }
        if (typeof spec.canvas.minHeight === 'number') {
          observations.push(obs(
            `canvas height ≥ ${spec.canvas.minHeight}`, `≥ ${spec.canvas.minHeight}`,
            canvasInfo.height ?? 'no canvas', canvasInfo.height >= spec.canvas.minHeight,
          ));
        }
        if (spec.canvas.centerNonBlack) {
          if (!canvasInfo.present) {
            observations.push(obs('canvas center not near-black', 'luminance > 8', 'no canvas', false));
          } else {
            // Screenshot a 2x2 patch at the canvas center and read its pixels.
            const cx = Math.max(0, Math.floor((canvasInfo.width || 0) / 2) - 1);
            const cy = Math.max(0, Math.floor((canvasInfo.height || 0) / 2) - 1);
            const shot = await page.screenshot({
              clip: {
                x: (canvasInfo.x ?? 0) + cx,
                y: (canvasInfo.y ?? 0) + cy,
                width: 2,
                height: 2,
              },
            });
            const { rgba } = decodePng(shot);
            const lum = Math.round(0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2]);
            observations.push(obs('canvas center not near-black', 'luminance > 8', `luminance=${lum}`, lum > 8));
          }
        }
      }

      const ok = observations.length > 0 && observations.every((o) => o.pass);
      return { ok, observations, errors, durationMs: Date.now() - t0, url };
    } catch (e) {
      if (e && e.code === 'BROWSER_UNAVAILABLE') {
        return {
          ok: false, observations, errors, durationMs: Date.now() - t0,
          reason: 'BROWSER_UNAVAILABLE', detail: e.detail || e.message,
        };
      }
      return { ok: false, observations, errors: [...errors, e.message.split('\n')[0]], durationMs: Date.now() - t0, url };
    } finally {
      if (launched) await launched.close();
    }
  }

  return { check };
}
