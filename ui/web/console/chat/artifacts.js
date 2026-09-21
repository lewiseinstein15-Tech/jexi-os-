/**
 * JEXI OS — Phase 16 Scope L — Terminal Inline Artifacts Panel
 *
 * The inline surface where a user inspects what a turn produced, opens a
 * single artifact, and copies or downloads it. It renders the metadata
 * Scope K emitted ({ path, kind, size, hash }) — it never re-scans the
 * filesystem to discover artifacts.
 *
 * Researched at source level:
 *  - Qredence/fleet-prime-agent, web/app/src/components/artifacts/.
 *    artifacts-utils.ts `collectSessionOpenUIBlocks` is shared between the
 *    chat renderer and the artifacts panel explicitly "so both see the exact
 *    same blocks for a session" — the panel AGGREGATES what the producing
 *    layer already emitted, it does not re-derive. artifacts-panel.tsx keeps a
 *    single `selectedArtifactId` (one artifact open at a time), maps an
 *    artifact status onto a display status, and renders diff output through a
 *    dedicated FileDiff with its own status. openui-artifact.ts caps persisted
 *    artifact bytes (MAX_OPENUI_HTML_ARTIFACT_BYTES) and byteLength()s with
 *    TextEncoder — size is a real byte count, not a character count.
 *  - Agent Elements EditTool: `getDiffLinesFromPatch` classifies each line by
 *    its +/- prefix (startsWith("+") -> added, startsWith("-") -> removed) and
 *    `calculateDiffStatsFromPatch` derives +N/-M stats. That is the rendering
 *    rule the Scope M view will use; the model here only carries kind.
 *  - Scope C rows: the terminal surface this panel lives inside, and the
 *    source of the --jcx-* theme tokens.
 *
 * Contract:
 *  artifacts.panel(turnId) -> {
 *    panelId, turnId,
 *    entries: [{ path, kind, size, hash, cardId, toolName, expanded, stale }],
 *    countsByKind: { patch: N, file: N, ... },
 *    empty: boolean
 *  }
 *  artifacts.open(panelId, path)  -> { path, kind, size, hash, content, stale?, expected?, actual? }
 *  artifacts.close(panelId, path) -> { path, expanded: false }
 *  artifacts.list(panelId)        -> entries only, never content
 *
 * Rules implemented:
 *  - Populated purely from Scope K card artifact arrays for the turn. panel()
 *    performs no I/O of any kind.
 *  - Content is lazy: open() reads, close() drops. The panel model never holds
 *    content — open content lives in a separate cache keyed by panel+path and
 *    is deleted on close.
 *  - Refused cards contribute NO entries: a refused tool never executed, so it
 *    produced nothing. No phantom artifacts.
 *  - Empty turn -> { empty: true, entries: [] }. Not an error.
 *  - Unknown turnId -> E_UNKNOWN_TURN. Unknown panelId -> E_UNKNOWN_PANEL.
 *    Unknown path -> E_UNKNOWN_ARTIFACT.
 *  - Duplicate open() is idempotent and does not re-read (see stats().reads).
 *  - Hash mismatch on open -> { stale: true, expected, actual, content }; the
 *    entry is flagged stale and the caller decides.
 *  - Deterministic: entries and countsByKind keys are ordered explicitly, and
 *    nothing on the panel path reads a clock.
 *
 * I/O is injected. This module lives in ui/web/ and must stay browser-safe, so
 * it never imports node:fs — the host supplies a reader via useSource(). With
 * no source configured open() fails loudly with E_NO_CONTENT_SOURCE rather
 * than fabricating content.
 */

import { toolcards } from './toolcards.js';

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

/* ------------------------------------------------------------------ *
 * Content source (injected I/O)
 * ------------------------------------------------------------------ */

let source = null;
const counters = { reads: 0, cacheHits: 0, opens: 0, closes: 0 };

/**
 * @param {{ read: (path: string, entry: object) => string|null }} next
 *   Synchronous reader. Returns null when the artifact cannot be read.
 *   The entry is passed so the host can serve kind-appropriate content.
 */
export function useSource(next) {
  if (next === null) { source = null; return { configured: false }; }
  if (!next || typeof next.read !== 'function') {
    throw fail('E_INVALID_SOURCE', 'a content source must expose read(path)');
  }
  source = next;
  return { configured: true };
}

/* ------------------------------------------------------------------ *
 * Panel store
 * ------------------------------------------------------------------ */

const panels = new Map();   // panelId -> { panelId, turnId, entries: Map<key, entry> }
const openContent = new Map(); // `${panelId}\u0000${path}` -> { content, size, hash, actualHash }

function entryKey(path, kind) {
  return `${path}\u0000${kind}`;
}

/** Aggregate Scope K artifact metadata for a turn. No I/O. */
function aggregate(turnId) {
  const entries = [];
  let turnSeen = false;

  for (const summary of toolcards.list()) {
    let card;
    try {
      card = toolcards.get(summary.cardId);
    } catch {
      continue; // card vanished between list() and get(); skip rather than throw
    }
    if (!card.tool || card.tool.turnId !== turnId) continue;
    turnSeen = true;
    // A refused tool never executed, so it produced nothing to show.
    if (card.status === 'refused') continue;

    const arts = (card.body && Array.isArray(card.body.artifacts)) ? card.body.artifacts : [];
    for (const a of arts) {
      if (!a || typeof a.path !== 'string') continue;
      entries.push({
        path: a.path,
        kind: typeof a.kind === 'string' ? a.kind : 'file',
        size: typeof a.size === 'number' ? a.size : 0,
        hash: typeof a.hash === 'string' ? a.hash : '',
        cardId: card.cardId,
        toolName: (card.tool && card.tool.name) || '',
        expanded: false,
        stale: false,
      });
    }
  }

  if (!turnSeen) throw fail('E_UNKNOWN_TURN', `Unknown turnId: ${turnId}`);

  // Explicit ordering: Scope K insertion order, then path, then kind.
  entries.sort((x, y) => (x.cardId < y.cardId ? -1 : x.cardId > y.cardId ? 1
    : x.path < y.path ? -1 : x.path > y.path ? 1
      : x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0));
  return entries;
}

function countsFor(entries) {
  const counts = {};
  for (const e of entries) counts[e.kind] = (counts[e.kind] || 0) + 1;
  // Sorted keys so JSON.stringify is byte-stable.
  const ordered = {};
  for (const k of Object.keys(counts).sort()) ordered[k] = counts[k];
  return ordered;
}

function panelModel(p) {
  const entries = [...p.entries.values()].map((e) => ({ ...e }));
  return {
    panelId: p.panelId,
    turnId: p.turnId,
    entries,
    countsByKind: countsFor(entries),
    empty: entries.length === 0,
  };
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export function panel(turnId) {
  if (typeof turnId !== 'string' || !turnId) throw fail('E_UNKNOWN_TURN', 'turnId is required');

  const panelId = `panel:${turnId}`;
  const existing = panels.get(panelId);

  if (existing) {
    // Refresh metadata from Scope K but preserve expansion/staleness state.
    const prior = existing.entries;
    const fresh = aggregate(turnId);
    const next = new Map();
    for (const e of fresh) {
      const before = prior.get(entryKey(e.path, e.kind));
      next.set(entryKey(e.path, e.kind), before ? { ...e, expanded: before.expanded, stale: before.stale } : e);
    }
    existing.entries = next;
    return panelModel(existing);
  }

  const entries = new Map();
  for (const e of aggregate(turnId)) entries.set(entryKey(e.path, e.kind), e);
  const p = { panelId, turnId, entries };
  panels.set(panelId, p);
  return panelModel(p);
}

export function list(panelId) {
  const p = panels.get(panelId);
  if (!p) throw fail('E_UNKNOWN_PANEL', `Unknown panelId: ${panelId}`);
  return [...p.entries.values()].map((e) => ({ ...e }));
}

export function open(panelId, path) {
  const p = panels.get(panelId);
  if (!p) throw fail('E_UNKNOWN_PANEL', `Unknown panelId: ${panelId}`);

  const entry = [...p.entries.values()].find((e) => e.path === path);
  if (!entry) throw fail('E_UNKNOWN_ARTIFACT', `Unknown artifact path in ${panelId}: ${path}`);

  const cacheKey = `${panelId}\u0000${path}`;
  counters.opens += 1;

  // Idempotent: an already-open artifact is served from the open cache and is
  // NOT read again.
  if (openContent.has(cacheKey)) {
    counters.cacheHits += 1;
    entry.expanded = true;
    const cached = openContent.get(cacheKey);
    return resultFor(entry, cached);
  }

  if (!source) {
    throw fail('E_NO_CONTENT_SOURCE', 'no content source configured; call artifacts.useSource({ read })');
  }

  // The reader gets the entry as well: a 'patch' artifact's content is the
  // patch text, not the bytes now sitting at `path`.
  const content = source.read(path, { ...entry });
  counters.reads += 1;
  if (typeof content !== 'string') {
    throw fail('E_ARTIFACT_UNREADABLE', `artifact could not be read: ${path}`);
  }

  const actualHash = toolcards.fingerprint(content);
  const cached = {
    content,
    size: byteLength(content),
    actualHash,
    stale: actualHash !== entry.hash,
  };
  openContent.set(cacheKey, cached);
  entry.expanded = true;
  entry.stale = cached.stale;

  return resultFor(entry, cached);
}

function resultFor(entry, cached) {
  const out = {
    path: entry.path,
    kind: entry.kind,
    size: entry.size,
    hash: entry.hash,
    content: cached.content,
  };
  if (cached.stale) {
    out.stale = true;
    out.expected = entry.hash;
    out.actual = cached.actualHash;
    out.actualSize = cached.size;
  }
  return out;
}

export function close(panelId, path) {
  const p = panels.get(panelId);
  if (!p) throw fail('E_UNKNOWN_PANEL', `Unknown panelId: ${panelId}`);

  const entry = [...p.entries.values()].find((e) => e.path === path);
  if (!entry) throw fail('E_UNKNOWN_ARTIFACT', `Unknown artifact path in ${panelId}: ${path}`);

  const cacheKey = `${panelId}\u0000${path}`;
  const dropped = openContent.delete(cacheKey); // content leaves memory here
  entry.expanded = false;
  counters.closes += 1;
  return { path, expanded: false, dropped };
}

/* ------------------------------------------------------------------ *
 * Inspection + probe seams
 * ------------------------------------------------------------------ */

export function stats() {
  return { ...counters };
}

/** Proof that the panel model carries no content field. */
export function holdsContent(panelId) {
  const p = panels.get(panelId);
  if (!p) throw fail('E_UNKNOWN_PANEL', `Unknown panelId: ${panelId}`);
  for (const e of p.entries.values()) {
    if ('content' in e) return true;
  }
  return false;
}

export function openPaths(panelId) {
  const p = panels.get(panelId);
  if (!p) throw fail('E_UNKNOWN_PANEL', `Unknown panelId: ${panelId}`);
  return [...p.entries.values()].filter((e) => e.expanded).map((e) => e.path);
}

export function _reset() {
  panels.clear();
  openContent.clear();
  counters.reads = 0;
  counters.cacheHits = 0;
  counters.opens = 0;
  counters.closes = 0;
}

function byteLength(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
  let n = 0;
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else n += 3;
  }
  return n;
}

export const artifacts = {
  panel,
  open,
  close,
  list,
  useSource,
  stats,
  holdsContent,
  openPaths,
  _reset,
};

export default artifacts;
