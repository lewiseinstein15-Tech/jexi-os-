// prompt/memory-fs/index.js
// Phase 25 — Scope E (+ Scope F epistemic gate + Scope G privacy
// blacklist). Public surface of the memory filesystem.
//
// Contract spellings:
//   tree.resolve(path)                    -> { absolute, parent, kind, valid, error? }
//   tree.list(dir)                        -> [{ path, kind, sizeBytes }]
//   tree.exists(path)                     -> boolean
//   writeRules.canWrite(path, writer, ctx)-> { allowed, reason?, errorCode? }
//   readRules.requiresPriorRead(path, ctx)-> { required, satisfied, errorCode? }
//   memoryFs.write(path, content, writer, ctx)
//                                         -> { written, absolutePath?, errorCode? }
//   memoryFs.read(path, ctx)              -> { content: string|null, exists }
//   epistemic.tag(content, source, opts)  -> { tagged, writable, tag, reason?, errorCode? }
//   epistemic.detectTag(content)          -> { tag: 'stated'|'inferred'|null, cleanContent }
//   epistemic.assertWritable(taggedEntry) -> { ok, tag, errorCode? }
//   blacklist.classify(content)           -> { allowed, matched[], excised, reason, method }
//   blacklist.excise(content)             -> { excised, removed[], log[], untouched }
//
// Rules implemented (see module headers for detail):
//   RULE 1  traversal refused                -> E_PATH_TRAVERSAL
//   RULE 2  /system/** writes refused        -> E_RESERVED_NAMESPACE
//   RULE 3  /refine/** writes refused        -> E_RESERVED_NAMESPACE
//   RULE 4  new topic auto-creates /topics/ — the IMMEDIATE parent only,
//           never a recursive virtual-tree mkdir
//   RULE 5  reading a missing path is NOT an error -> { content: null, exists: false }
//   RULE 6  read-before-write for UPDATE (not CREATE)
//   RULE 7  normalization: leading slash + trailing .md optional
//   RULE 8  reserved-namespace check case-insensitive, on the
//           normalized path
//
// Persistence: REAL fs reads/writes under <projectRoot>/.jexi/memory-fs/
// (gitignored via the .jexi/ rule). No simulation, no in-memory shim.
//
// Scope F — EPISTEMOLOGICAL TAGGING: every entry carries its epistemic
// tag. Reads stay tag-agnostic — reading is allowed for both tags, only
// writing is restricted (Scope F RULE 4).
//
// Scope G — PRIVACY BLACKLIST: memoryFs.write() surgically excises
// blacklisted categories (clinical / mental / personality / financial /
// identity / biometric) from the content BEFORE anything else, then tags
// the EXCISED content. Order: excise -> tag -> assertWritable -> Scope E
// rules -> disk. If nothing survives excision the write is refused with
// E_ALL_EXCISED and NOTHING touches disk (not even store-root creation).
// Pre-tagged content passes through the tag step unchanged (no double-
// tagging); untagged content is auto-tagged from the writer's epistemic
// source (see EPISTEMIC_SOURCE_BY_ROLE below).
//
// ctx.audit: when ctx.audit is an array, write() appends one record per
// COMPLETED stage ({stage:'excise'|'tag'|'assert'|'disk', ...}) so callers
// can prove the enforcement order. Refused writes record the stages that
// ran before the refusal (e.g. E_ALL_EXCISED leaves exactly one 'excise'
// record).

import fs from 'node:fs';
import nodePath from 'node:path';
import * as tree from './tree.js';
import * as writeRules from './write-rules.js';
import * as readRules from './read-rules.js';
import * as epistemic from './epistemic.js';
import * as blacklist from './privacy-blacklist.js';

export { tree, writeRules, readRules, epistemic, blacklist };
export const CODES = tree.CODES;
export const EPISTEMIC_CODES = epistemic.EPISTEMIC_CODES;
export const BLACKLIST_CODES = blacklist.BLACKLIST_CODES;
export const LAYOUT = tree.LAYOUT;
export const storeRoot = tree.storeRoot;
export const PROJECT_ROOT = tree.PROJECT_ROOT;

/**
 * Writer role -> epistemic source (Scope G integration mapping), used ONLY
 * when content arrives without a leading tag and must be auto-tagged:
 *   user   -> 'user'    (auto [stated])
 *   agent  -> 'model'   (the agent IS the model: untagged agent text is an
 *                        inference -> [inferred] -> never written)
 *   kernel -> 'system'  (platform ground truth, still gated by
 *                        opts.systemWritable — pass ctx.systemWritable:true)
 *   system -> 'system'
 * Unknown roles pass through unchanged -> epistemic.tag refuses with
 * E_UNKNOWN_SOURCE. Pre-tagged content never consults this mapping.
 */
const EPISTEMIC_SOURCE_BY_ROLE = Object.freeze({
  user: 'user',
  model: 'model',
  agent: 'model',
  kernel: 'system',
  system: 'system',
});

function epistemicSourceOf(writer) {
  let role = writer;
  if (writer !== null && typeof writer === 'object' && typeof writer.role === 'string') {
    role = writer.role;
  }
  if (role === undefined || role === null) role = 'agent'; // default actor
  return Object.prototype.hasOwnProperty.call(EPISTEMIC_SOURCE_BY_ROLE, role)
    ? EPISTEMIC_SOURCE_BY_ROLE[role]
    : role;
}

/** Record a successful file read into ctx.session.reads (RULE 6 tracking). */
function recordRead(ctx, absolute) {
  const session = ctx && typeof ctx === 'object' ? ctx.session : undefined;
  if (session && typeof session === 'object') {
    if (!(session.reads instanceof Set)) session.reads = new Set();
    session.reads.add(absolute);
  }
}

export const memoryFs = {
  /**
   * memoryFs.write(path, content, writer, ctx)
   *   -> { written, absolutePath?, reason?, errorCode? }
   *
   * Order of enforcement (Scope G integration — excise -> tag ->
   * assertWritable -> Scope E rules -> disk):
   *   1. content type check      (string only)
   *   2. blacklist.excise        (blacklisted categories surgically removed;
   *                               nothing left -> E_ALL_EXCISED, no disk touch)
   *   3. epistemic.tag           (pre-tagged content passes through; untagged
   *      content is auto-tagged from the writer's epistemic source)
   *   4. epistemic.assertWritable (final gate: tag present, [inferred] NEVER
   *      written, double tag refused)
   *   5. writeRules.canWrite     (traversal / reserved / directory shape / role)
   *   6. UPDATE? -> readRules.requiresPriorRead (Scope E RULE 6)
   *   7. real disk write of the TAGGED, EXCISED content; auto-create
   *      IMMEDIATE parent only (Scope E RULE 4)
   */
  write(path, content, writer, ctx) {
    if (typeof content !== 'string') {
      return {
        written: false,
        reason: 'content must be a string',
        errorCode: CODES.INVALID_CONTENT,
      };
    }

    const audit =
      ctx && typeof ctx === 'object' && Array.isArray(ctx.audit) ? ctx.audit : null;

    // Scope G — STEP 1: excise blacklisted categories BEFORE anything else.
    const ex = blacklist.excise(content);
    if (audit) {
      audit.push({
        stage: 'excise',
        beforeBytes: content.length,
        afterBytes: ex.excised.length,
        removed: ex.removed.map((r) => r.category),
      });
    }

    // Scope G RULE 2 — no payload survived excision -> no file write.
    // Tag-prefix-aware: "[stated] user is diabetic" excises down to a bare
    // tag remnant (with or without its closing bracket), which is just as
    // unwritable as an empty string.
    const detected = epistemic.detectTag(ex.excised);
    const residualPayload = detected.tag !== null ? detected.cleanContent : ex.excised;
    const residualTrimmed = residualPayload.trim();
    if (residualTrimmed === '' || /^\[(stated|inferred)\]?$/.test(residualTrimmed)) {
      return {
        written: false,
        reason: 'every blacklisted span was excised — no content remains to write (RULE 2)',
        errorCode: blacklist.BLACKLIST_CODES.ALL_EXCISED,
      };
    }

    // STEP 2 (Scope F): tag the EXCISED content. Pre-tagged content passes
    // through unchanged; untagged content is auto-tagged from the writer's
    // epistemic source (refusals: E_INFERRED_NOT_WRITABLE /
    // E_SYSTEM_WRITE_REFUSED / E_UNKNOWN_SOURCE).
    let tagged;
    let tagUsed;
    if (detected.tag !== null) {
      tagged = ex.excised;
      tagUsed = detected.tag;
    } else {
      const t = epistemic.tag(
        ex.excised,
        epistemicSourceOf(writer),
        ctx && typeof ctx === 'object' ? ctx : {},
      );
      if (!t.writable) {
        return { written: false, reason: t.reason, errorCode: t.errorCode };
      }
      tagged = t.tagged;
      tagUsed = t.tag;
    }
    if (audit) {
      audit.push({ stage: 'tag', tag: tagUsed, bytes: tagged.length, onExcisedBytes: ex.excised.length });
    }

    // STEP 3 (Scope F): final epistemic gate on the tagged entry.
    const aw = epistemic.assertWritable(tagged);
    if (!aw.ok) {
      return { written: false, reason: aw.reason, errorCode: aw.errorCode };
    }
    if (audit) {
      audit.push({ stage: 'assert', ok: true, tag: aw.tag });
    }

    const cw = writeRules.canWrite(path, writer, ctx);
    if (!cw.allowed) {
      return { written: false, reason: cw.reason, errorCode: cw.errorCode };
    }

    const r = tree.resolve(path); // valid — canWrite already passed

    const isUpdate = tree.exists(r.absolute);
    if (isUpdate) {
      const pr = readRules.requiresPriorRead(r.absolute, ctx);
      if (pr.errorCode) {
        return {
          written: false,
          reason: 'update of an existing file requires a prior read in the current session (RULE 6)',
          errorCode: pr.errorCode,
        };
      }
    }

    const root = tree.storeRoot();
    // Infrastructure bootstrap OUTSIDE the virtual tree: make sure the
    // store root exists. Virtual-tree parents are created NON-recursive
    // below — RULE 4 auto-creates only the immediate parent.
    fs.mkdirSync(root, { recursive: true });

    if (r.parent && r.parent !== '/') {
      try {
        fs.mkdirSync(nodePath.join(root, r.parent), { recursive: false });
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    }

    // Scope G — the disk sees the TAGGED, EXCISED content. Nothing else.
    fs.writeFileSync(nodePath.join(root, r.absolute), tagged, 'utf8');
    if (audit) {
      audit.push({ stage: 'disk', bytes: tagged.length, absolutePath: r.absolute });
    }
    return { written: true, absolutePath: r.absolute };
  },

  /**
   * memoryFs.read(path, ctx) -> { content: string|null, exists: boolean }
   *
   * RULE 5 (Scope E): a missing path is NOT an error — { content: null,
   * exists: false } and the caller decides. Reserved namespaces are never
   * backed by this store (reads report not-found; nothing is read from
   * their disk paths). Successful file reads are recorded into
   * ctx.session.reads (Scope E RULE 6). Reads are TAG-AGNOSTIC (Scope F
   * RULE 4): both [stated] and [inferred] content is returned; callers
   * split via epistemic.detectTag(). Invalid (traversal/malformed) inputs
   * additionally carry errorCode so refusals stay visible without throwing.
   */
  read(path, ctx) {
    const r = tree.resolve(path);
    if (!r.valid) {
      return { content: null, exists: false, errorCode: r.error.code };
    }

    const head = r.absolute === '/' ? '' : r.absolute.slice(1).split('/')[0];
    if (head && tree.LAYOUT.RESERVED_SET.has(head.toLowerCase())) {
      return { content: null, exists: false }; // reserved: never stored here
    }

    const disk = nodePath.join(tree.storeRoot(), r.absolute);
    let st;
    try {
      st = fs.statSync(disk);
    } catch {
      return { content: null, exists: false }; // RULE 5 — missing, not an error
    }

    if (st.isDirectory()) {
      return { content: null, exists: true }; // directories have no content
    }

    let content;
    try {
      content = fs.readFileSync(disk, 'utf8');
    } catch {
      return { content: null, exists: false };
    }

    recordRead(ctx, r.absolute);
    return { content, exists: true };
  },
};

export default memoryFs;
