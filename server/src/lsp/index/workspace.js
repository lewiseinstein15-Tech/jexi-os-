/**
 * JEXI OS — LSP workspace index.
 *
 * On mission start the workspace is walked and every source file is opened in
 * its language server (`textDocument/didOpen`) so diagnostics publish without
 * waiting for the caller to touch each file. The index also tracks the live
 * document versions so subsequent didChange calls stay correct.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { route, serverForPath } from '../router.js';

/** Directories never worth indexing. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', 'vendor', '__pycache__']);

/** Files larger than this are not opened (language servers choke on them). */
const MAX_FILE_BYTES = 512 * 1024;

/**
 * Walk `root` and return indexable source files, depth-first, capped.
 * @returns {string[]} absolute paths
 */
export function walkWorkspace(root, { maxFiles = 400, maxDepth = 8 } = {}) {
  const out = [];
  const rootReal = path.resolve(root);
  const stack = [{ dir: rootReal, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return out;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (!serverForPath(full)) continue;
      try {
        if (fs.statSync(full).size > MAX_FILE_BYTES) continue;
      } catch {
        continue;
      }
      out.push(full);
    }
  }
  return out;
}

/** Detect the languageId for a file from the router's catalog. */
export function languageIdFor(filePath) {
  const server = serverForPath(filePath);
  if (!server) return 'plaintext';
  return server.languageId(path.extname(filePath).toLowerCase());
}

/**
 * Build an index for `root`: open every source file in its language server.
 *
 * @param {object} manager  from manager.js
 * @param {string} root     workspace root
 * @returns {Promise<object>} { root, files, opened, skipped, byServer }
 */
export async function buildIndex(manager, root, opts = {}) {
  const files = walkWorkspace(root, opts);
  const byServer = {};
  let opened = 0;
  const skipped = [];

  for (const file of files) {
    const r = route(file);
    if (!r.available) {
      skipped.push({ file, reason: r.reason });
      continue;
    }
    let client;
    try {
      client = await manager.ensureServer(r.server, r.argv, root);
    } catch (err) {
      skipped.push({ file, reason: `language server failed to start: ${err.message}` });
      continue;
    }
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      skipped.push({ file, reason: 'unreadable' });
      continue;
    }
    client.notify('textDocument/didOpen', {
      textDocument: { uri: pathToFileURL(file).href, languageId: languageIdFor(file), version: 1, text },
    });
    manager.trackDocument(file, 1);
    byServer[r.server] = (byServer[r.server] ?? 0) + 1;
    opened += 1;
  }

  return { root: path.resolve(root), files: files.length, opened, skipped: skipped.length, skippedDetail: skipped.slice(0, 20), byServer };
}
