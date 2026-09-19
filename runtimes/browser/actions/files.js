/**
 * JEXI OS — Phase 17 Scope B — FILE IO ACTIONS.
 *
 * Uploads live in forms.js (they need a file input). This module covers
 * downloads and the sandboxed read/write of text files that browser tasks
 * commonly need.
 *
 * ── DOWNLOADS ──────────────────────────────────────────────────────────────
 * Obscura has no download manager: CDP's `Browser.setDownloadBehavior` /
 * `Page.setDownloadBehavior` are not implemented, and there is no
 * `Page.downloadWillBegin` event. Downloads are therefore captured by fetching
 * the URL through the PAGE (so the request carries the page's cookies and
 * headers) and writing the bytes to disk under the output directory. The action
 * reports `method: "page-fetch"` so it is never confused with a browser-managed
 * download.
 *
 * ── FILE READS/WRITES ──────────────────────────────────────────────────────
 * Confined to JEXI_OUTPUT_DIR (default `<cwd>/output`). A path outside it is
 * refused, not silently clamped. This keeps a browsing task from reading
 * arbitrary host files or writing over the repository.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ActionError } from './registry.js';

/** The only directory these actions may touch. */
export function outputDir() {
  return path.resolve(process.env.JEXI_OUTPUT_DIR || path.join(process.cwd(), 'output'));
}

/** Resolve a path inside the output directory, or refuse. */
export function confinedPath(filePath, action) {
  const base = outputDir();
  const resolved = path.resolve(filePath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new ActionError(action, `refusing to touch ${resolved} — it is outside the output directory ${base}`);
  }
  return resolved;
}

export function fileActions() {
  return [
    {
      name: 'download_file',
      description: 'Fetch a URL through the page (carrying its cookies) and write the bytes to the output directory. Not a browser-managed download — Obscura has no download manager.',
      risk: 'medium',
      permissions: ['filesystem', 'network'],
      timeout_ms: 60_000,
      retries: 1,
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', minLength: 1, description: 'Absolute URL to fetch' },
          path: { type: 'string', description: 'Destination inside the output directory (default: derived from the URL)' },
          as_base64: { type: 'boolean', description: 'Return the bytes inline as base64 instead of writing a file' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { ok: { type: 'boolean' }, bytes: { type: 'integer' }, method: { type: 'string' } }, required: ['ok', 'method'] },
      handler: async ({ url, path: dest, as_base64 = false }, { session }) => {
        if (!/^https?:/i.test(url)) throw new ActionError('download_file', `refusing ${JSON.stringify(url)} — only http(s) URLs can be fetched`);
        const data = await session.evalJson(`(async () => {
          const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
          if (!r.ok) return { ok: false, status: r.status, statusText: r.statusText };
          const buf = new Uint8Array(await r.arrayBuffer());
          let binary = '';
          const chunk = 8192;
          for (let i = 0; i < buf.length; i += chunk) binary += String.fromCharCode.apply(null, buf.subarray(i, i + chunk));
          return { ok: true, status: r.status, contentType: r.headers.get('content-type') || '', base64: btoa(binary) };
        })()`);
        if (!data?.ok) throw new ActionError('download_file', `fetch failed — HTTP ${data?.status} ${data?.statusText || ''}`.trim(), { code: 'E_DOWNLOAD_FAILED' });
        const buffer = Buffer.from(data.base64, 'base64');
        if (as_base64) return { ok: true, bytes: buffer.length, method: 'page-fetch', content_type: data.contentType, base64: data.base64 };
        const target = confinedPath(dest || path.join(outputDir(), path.basename(new URL(url).pathname) || `download-${Date.now()}.bin`), 'download_file');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, buffer);
        return { ok: true, bytes: buffer.length, path: target, method: 'page-fetch', content_type: data.contentType, note: 'captured via page fetch — Obscura does not implement browser-managed downloads' };
      },
    },
    {
      name: 'read_file',
      description: 'Read a text file from the output directory.',
      risk: 'low',
      permissions: ['filesystem'],
      timeout_ms: 15_000,
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string', minLength: 1 }, max_chars: { type: 'integer', minimum: 1, maximum: 1_000_000 } },
        required: ['path'],
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { content: { type: 'string' }, bytes: { type: 'integer' } }, required: ['content', 'bytes'] },
      handler: async ({ path: p, max_chars = 100_000 }) => {
        const target = confinedPath(p, 'read_file');
        if (!fs.existsSync(target)) throw new ActionError('read_file', `no such file — ${target}`, { code: 'E_FILE_NOT_FOUND' });
        const raw = fs.readFileSync(target, 'utf8');
        return { content: raw.slice(0, max_chars), bytes: Buffer.byteLength(raw), truncated: raw.length > max_chars, path: target };
      },
    },
    {
      name: 'write_file',
      description: 'Write a text file into the output directory.',
      risk: 'medium',
      permissions: ['filesystem'],
      timeout_ms: 15_000,
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string', minLength: 1 }, content: { type: 'string' }, append: { type: 'boolean' } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { written: { type: 'boolean' }, bytes: { type: 'integer' } }, required: ['written', 'bytes'] },
      handler: async ({ path: p, content, append = false }) => {
        const target = confinedPath(p, 'write_file');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (append) fs.appendFileSync(target, content);
        else fs.writeFileSync(target, content);
        return { written: true, bytes: Buffer.byteLength(content), path: target, mode: append ? 'append' : 'overwrite' };
      },
    },
    {
      name: 'list_files',
      description: 'List files in the output directory.',
      risk: 'low',
      permissions: ['filesystem'],
      timeout_ms: 15_000,
      input_schema: {
        type: 'object',
        properties: { subdir: { type: 'string', description: 'Relative subdirectory of the output directory' } },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { count: { type: 'integer' }, files: { type: 'array' } }, required: ['count', 'files'] },
      handler: async ({ subdir = '.' }) => {
        const base = confinedPath(path.join(outputDir(), subdir), 'list_files');
        if (!fs.existsSync(base)) return { count: 0, files: [], directory: base };
        const files = fs.readdirSync(base, { withFileTypes: true }).map((d) => ({
          name: d.name, type: d.isDirectory() ? 'dir' : 'file',
          bytes: d.isFile() ? fs.statSync(path.join(base, d.name)).size : null,
        }));
        return { count: files.length, files, directory: base };
      },
    },
    {
      name: 'save_screenshot',
      description: 'Convenience wrapper: capture the page and save it into the output directory.',
      risk: 'low',
      permissions: ['read', 'filesystem'],
      timeout_ms: 30_000,
      input_schema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'File name (default screenshot-<timestamp>.png)' }, full_page: { type: 'boolean' } },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { path: { type: 'string' }, bytes: { type: 'integer' } }, required: ['path', 'bytes'] },
      handler: async ({ name, full_page = false }, { session }) => {
        const r = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full_page === true });
        if (!r.data) throw new ActionError('save_screenshot', 'the engine returned no image data');
        const buffer = Buffer.from(r.data, 'base64');
        const target = confinedPath(path.join(outputDir(), name || `screenshot-${Date.now()}.png`), 'save_screenshot');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, buffer);
        return { path: target, bytes: buffer.length, full_page };
      },
    },
  ];
}

export default { fileActions, outputDir, confinedPath };
