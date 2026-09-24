/**
 * JEXI OS — Phase 17 Scope E — CONTEXT FILESYSTEM / FILESYSTEM.
 *
 * A REAL filesystem with a virtual address space: every viking:// URI maps to
 * a file under a root directory (default `<repo>/data/viking`, overridable).
 *
 *   viking://resources/test/foo.md  →  <root>/resources/test/foo.md
 *
 * TIERS — where each tier lives:
 *   L2 (details)      the file itself (for directories: the rendered tree).
 *   L0 (one sentence) + L1 (overview) live in a per-DIRECTORY sidecar:
 *       <dir>/.viking/meta.json
 *   so relevance can be judged for a whole directory without opening ANY L2
 *   file: the sidecar carries the directory's own L0/L1 (`self`) and the
 *   L0/L1 of every child entry (`entries`). `.viking/` is never listed.
 *
 * Sidecar entry shape:
 *   { l0: string, l1: string, tokens: { L0, L1 },
 *     l0By: 'explicit'|'auto', l1By: 'explicit'|'auto', updatedAt: ISO }
 * `auto` generation is DETERMINISTIC (first sentence / first paragraph,
 * word-safe truncation) and labeled — it is NOT an LLM summary.
 *
 * TOKENS: estimateTokens = ceil(chars / 4) — the same documented convention
 * as server/src/memory/interface/MemoryProvider.js. Real byte lengths for
 * `stat.size`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseUri, buildUri, joinUri, baseName } from './uri.js';

export const SIDECAR_DIR = '.viking';
export const SIDECAR_FILE = 'meta.json';

export const AUTO_LABEL = 'auto (deterministic first-sentence/first-paragraph) — LLM summarization NOT VERIFIED';
export const EXPLICIT_LABEL = 'explicit (caller-provided)';

/** Documented token estimator (chars/4, matching the Phase 4 convention). */
export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text ?? '').length / 4));
}

/** First sentence — deterministic; markdown heading lines are skipped. */
export function firstSentence(text, { maxChars = 160 } = {}) {
  const t = String(text || '').replace(/^#{1,6}\s.*$/gm, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  const s = m ? m[1] : t;
  return s.length <= maxChars ? s : `${s.slice(0, maxChars - 1).replace(/\s+\S*$/, '')}…`;
}

/** First paragraph (word-safe cap) — deterministic. */
export function firstParagraph(text, { maxChars = 480 } = {}) {
  const t = String(text || '').trim();
  if (!t) return '';
  const para = t.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  return para.length <= maxChars ? para : `${para.slice(0, maxChars - 1).replace(/\s+\S*$/, '')}…`;
}

export class VikingFs {
  /**
   * @param {object} [o]
   * @param {string} [o.root]    disk root (default <repo>/data/viking)
   */
  constructor(o = {}) {
    this.root = path.resolve(o.root || new URL('../../../data/viking', import.meta.url).pathname);
    fs.mkdirSync(this.root, { recursive: true });
  }

  /** viking:// URI → absolute disk path (traversal-safe by construction). */
  diskPath(uri) {
    const { scope, path: p } = parseUri(uri);
    return p ? path.join(this.root, scope, p) : path.join(this.root, scope);
  }

  sidecarPathForDir(dirDisk) {
    return path.join(dirDisk, SIDECAR_DIR, SIDECAR_FILE);
  }

  readSidecar(dirDisk) {
    try {
      return JSON.parse(fs.readFileSync(this.sidecarPathForDir(dirDisk), 'utf8'));
    } catch {
      return { self: null, entries: {} };
    }
  }

  writeSidecar(dirDisk, sidecar) {
    fs.mkdirSync(path.join(dirDisk, SIDECAR_DIR), { recursive: true });
    fs.writeFileSync(this.sidecarPathForDir(dirDisk), JSON.stringify(sidecar, null, 2) + '\n');
  }

  /**
   * Write an L2 file and generate/refresh its L0+L1 sidecars.
   * @param {string} uri      viking:// URI (file)
   * @param {string} content  full (L2) content
   * @param {object} [o]      { l0, l1 } explicit sidecars; auto-generated when absent
   * @returns {{ written: true, uri, tier: 'L2', bytes, tokens: {L0,L1,L2},
   *              sidecars: { L0: 'explicit'|'auto', L1: 'explicit'|'auto' } }}
   */
  write(uri, content, o = {}) {
    const text = String(content ?? '');
    const disk = this.diskPath(uri);
    fs.mkdirSync(path.dirname(disk), { recursive: true });
    fs.writeFileSync(disk, text);

    const { scope, path: p } = parseUri(uri);
    const name = baseName(uri);
    const parentDisk = path.dirname(disk);
    const sidecar = this.readSidecar(parentDisk);
    const l0 = o.l0 != null ? String(o.l0) : firstSentence(text);
    const l1 = o.l1 != null ? String(o.l1) : firstParagraph(text);
    sidecar.entries = sidecar.entries || {};
    sidecar.entries[name] = {
      l0,
      l1,
      tokens: { L0: estimateTokens(l0), L1: estimateTokens(l1), L2: estimateTokens(text) },
      l0By: o.l0 != null ? EXPLICIT_LABEL : AUTO_LABEL,
      l1By: o.l1 != null ? EXPLICIT_LABEL : AUTO_LABEL,
      updatedAt: new Date().toISOString(),
    };
    this.writeSidecar(parentDisk, sidecar);
    this.refreshDirSelf(buildUri({ scope, path: p ? p.split('/').slice(0, -1).join('/') : '' }));

    return {
      written: true,
      uri: String(uri),
      tier: 'L2',
      bytes: Buffer.byteLength(text),
      tokens: sidecar.entries[name].tokens,
      sidecars: { L0: sidecar.entries[name].l0By, L1: sidecar.entries[name].l1By },
    };
  }

  /** Directory self-L0/L1 refresh (deterministic; derived from its entries). */
  refreshDirSelf(uri) {
    const disk = this.diskPath(uri);
    if (!fs.existsSync(disk) || !fs.statSync(disk).isDirectory()) return;
    const sidecar = this.readSidecar(disk);
    const names = this.listDisk(disk);
    sidecar.self = {
      l0: `Directory ${baseName(uri)} with ${names.length} entr${names.length === 1 ? 'y' : 'ies'}.`,
      l1: `Contents: ${names.map((n) => (n.endsWith('/') ? `${n.slice(0, -1)}/ (dir)` : n)).join(', ') || '(empty)'}.`,
      tokens: null, // filled below
      by: AUTO_LABEL,
      updatedAt: new Date().toISOString(),
    };
    sidecar.self.tokens = { L0: estimateTokens(sidecar.self.l0), L1: estimateTokens(sidecar.self.l1) };
    this.writeSidecar(disk, sidecar);
  }

  listDisk(dirDisk) {
    return fs.readdirSync(dirDisk)
      .filter((n) => n !== SIDECAR_DIR)
      .map((n) => (fs.statSync(path.join(dirDisk, n)).isDirectory() ? `${n}/` : n));
  }

  /** Does this URI exist (file or dir)? */
  exists(uri) {
    try {
      const disk = this.diskPath(uri);
      return fs.existsSync(disk);
    } catch {
      return false;
    }
  }

  typeOf(uri) {
    const st = fs.statSync(this.diskPath(uri));
    return st.isDirectory() ? 'dir' : 'file';
  }

  /** Sidecar record for a node (file: from parent sidecar; dir: its own self). */
  metaOf(uri) {
    const { scope, path: p } = parseUri(uri);
    const disk = this.diskPath(uri);
    if (!p) { // scope root — its self lives in its own sidecar
      const s = this.readSidecar(disk);
      return s.self;
    }
    if (this.typeOf(uri) === 'dir') return this.readSidecar(disk).self;
    const parentMeta = this.readSidecar(path.dirname(disk));
    return (parentMeta.entries || {})[baseName(uri)] || null;
  }

  /**
   * ls(uri) → entries with their L0 sidecar attached.
   * @returns {Array<{name, type, uri, l0, l1, hasL0, hasL1}>}
   */
  ls(uri) {
    const disk = this.diskPath(uri);
    if (!fs.existsSync(disk)) {
      const e = new Error(`ls: no such viking path ${uri}`);
      e.code = 'E_NOT_FOUND';
      throw e;
    }
    if (this.typeOf(uri) === 'file') return [];
    const sidecar = this.readSidecar(disk);
    return this.listDisk(disk).map((raw) => {
      const isDir = raw.endsWith('/');
      const name = isDir ? raw.slice(0, -1) : raw;
      const childUri = joinUri(uri, name);
      // Directories carry their own L0 (self sidecar); files use the parent's entry record.
      const meta = isDir ? this.readSidecar(this.diskPath(childUri)).self : (sidecar.entries || {})[name] || null;
      return {
        name,
        type: isDir ? 'dir' : 'file',
        uri: childUri,
        l0: meta?.l0 ?? null,
        l1: meta?.l1 ?? null,
        hasL0: Boolean(meta?.l0),
        hasL1: Boolean(meta?.l1),
        tokens: meta?.tokens || null,
      };
    });
  }

  /** tree(uri, {depth}) → nested view; every node carries its L0. */
  tree(uri, { depth = 3 } = {}) {
    const type = this.typeOf(uri);
    const meta = this.metaOf(uri);
    const node = {
      name: baseName(uri),
      type,
      uri: String(uri),
      l0: meta?.l0 ?? null,
    };
    if (type === 'dir' && depth > 0) {
      node.children = this.ls(uri)
        .map((e) => (e.type === 'dir' ? this.tree(e.uri, { depth: depth - 1 }) : { name: e.name, type: 'file', uri: e.uri, l0: e.l0 }));
    }
    return node;
  }

  /** Render a directory subtree as plain text (a dir's L2 content). */
  renderTree(uri, { depth = 4 } = {}) {
    const walk = (u, indent) => {
      const lines = [];
      for (const e of this.ls(u)) {
        lines.push(`${indent}${e.name}${e.type === 'dir' ? '/' : ''} — ${e.l0 ?? '(no L0)'}`);
        if (e.type === 'dir' && indent.length / 2 < depth) lines.push(...walk(e.uri, `${indent}  `));
      }
      return lines;
    };
    return [`# ${String(uri)}`, ...walk(uri, '  ')].join('\n');
  }

  /**
   * read(uri, {tier}) → { uri, tier, content, tokens }
   * L0/L1 come from sidecars; L2 from the file (dirs: rendered tree).
   */
  read(uri, { tier = 'L2' } = {}) {
    if (!['L0', 'L1', 'L2'].includes(tier)) {
      const e = new Error(`read: unknown tier ${JSON.stringify(tier)} — expected L0|L1|L2`);
      e.code = 'E_INVALID_TIER';
      throw e;
    }
    const disk = this.diskPath(uri);
    if (!fs.existsSync(disk)) {
      const e = new Error(`read: no such viking path ${uri}`);
      e.code = 'E_NOT_FOUND';
      throw e;
    }
    const meta = this.metaOf(uri);
    if (tier === 'L0' || tier === 'L1') {
      const key = tier.toLowerCase();
      if (!meta || !meta[key]) {
        const e = new Error(`read: ${tier} sidecar not present for ${uri}`);
        e.code = 'E_NO_TIER';
        throw e;
      }
      return { uri: String(uri), tier, content: meta[key], tokens: estimateTokens(meta[key]), by: meta[`${key}By`] || null };
    }
    const content = this.typeOf(uri) === 'dir' ? this.renderTree(uri) : fs.readFileSync(disk, 'utf8');
    return { uri: String(uri), tier, content, tokens: estimateTokens(content) };
  }

  /**
   * stat(uri) → { type, size, tiers, tierTokens, lastModified }
   * tiers = which of L0/L1/L2 exist here; size = L2 bytes.
   */
  stat(uri) {
    const disk = this.diskPath(uri);
    if (!fs.existsSync(disk)) {
      const e = new Error(`stat: no such viking path ${uri}`);
      e.code = 'E_NOT_FOUND';
      throw e;
    }
    const type = this.typeOf(uri);
    const st = fs.statSync(disk);
    const meta = this.metaOf(uri);
    let size = type === 'file' ? st.size : 0;
    let l2 = null;
    if (type === 'dir') {
      const walk = (u) => {
        let sum = 0;
        for (const e of this.ls(u)) sum += e.type === 'dir' ? walk(e.uri) : fs.statSync(this.diskPath(e.uri)).size;
        return sum;
      };
      size = walk(uri);
      l2 = { content: this.renderTree(uri), tokens: 0 };
      l2.tokens = estimateTokens(l2.content);
    } else {
      const content = fs.readFileSync(disk, 'utf8');
      l2 = { tokens: estimateTokens(content) };
    }
    const tiers = [];
    const tierTokens = {};
    if (meta?.l0) { tiers.push('L0'); tierTokens.L0 = estimateTokens(meta.l0); }
    if (meta?.l1) { tiers.push('L1'); tierTokens.L1 = estimateTokens(meta.l1); }
    tiers.push('L2');
    tierTokens.L2 = l2.tokens;
    return { uri: String(uri), type, size, tiers, tierTokens, lastModified: st.mtime.toISOString() };
  }
}

export default { VikingFs, estimateTokens, firstSentence, firstParagraph, SIDECAR_DIR, SIDECAR_FILE, AUTO_LABEL, EXPLICIT_LABEL };
