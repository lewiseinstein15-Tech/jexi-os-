/**
 * JEXI OS — Phase 10 Scope I — CONTEXT OFFLOAD
 *
 * Long contexts don't fit in the model window. Instead of truncating,
 * JEXI writes them to disk and lets agents reference them by name.
 * Same info, fewer tokens in context.
 *
 * Token measurement:
 *   tokens = Math.ceil(chars / 4)
 * This is a LABELED deterministic approximation (~4 chars per token for
 * English). Same convention as:
 *  - context/viking/filesystem.js
 *  - server/src/memory/interface/MemoryProvider.js
 *  - capability/code/graph-first.js (bytes/4)
 * It is NOT a BPE tokenizer; use for budgeting, not billing.
 *
 * Storage:
 *  - Offloads: .jexi/offload/<name>  (0600, fsync on write)
 *  - Sessions: .jexi/sessions/<sessionId>.ndjson (read-only from here)
 *
 * Contracts:
 *  offload.write(name, content, opts) → { path, name, sizeBytes, sha256, written:true }
 *  offload.read(name, opts) → { content, sizeBytes, sha256 }
 *  offload.readRange(name, {start,end}) → { content, rangeStart, rangeEnd, totalBytes }
 *  offload.list() → [{ name, path, sizeBytes, createdAt, sha256 }]
 *  offload.delete(name) → { deleted:true }
 *
 *  history.query({sessionId, filter?, limit?}) → [{ id, parentId, kind, payload, ts }]
 *  history.recent(sessionId, n) → last n
 *  history.search(sessionId, predicate) → matching nodes
 *
 * Rules enforced:
 *  - Name regex [A-Za-z0-9_-]+ else E_INVALID_NAME
 *  - Collision → E_OFFLOAD_EXISTS unless overwrite:true
 *  - Missing → E_OFFLOAD_NOT_FOUND
 *  - sha256 on read must match content hash (computed on read)
 *  - history is READ-ONLY, single-pass NDJSON reader
 */

import { offload, DEFAULT_OFFLOAD_DIR, estimateTokens, sha256, sizeBytes, validateName } from './file.js';
import { history, DEFAULT_SESSION_DIR } from './history.js';

export { offload, history, estimateTokens, sha256, sizeBytes, validateName, DEFAULT_OFFLOAD_DIR, DEFAULT_SESSION_DIR };
export * from './file.js';
export * from './history.js';

// ── INTEGRATION (display only — do NOT wire) ──
//
// How RLM REPL could call offload.read(name):
//
//   import { offload } from '../context/offload/index.js';
//   import { PersistentRepl } from '../rlm/kernel/persistent-repl.js';
//
//   const repl = new PersistentRepl();
//   // Write once from host:
//   offload.write('big', hugeContextString);
//
//   // Inside REPL cell, reference by name instead of pasting 200KB:
//   const cell = `
//     // Only the name travels in the prompt, not the 200KB
//     const ref = 'big';
//     const { content, sha256 } = hostOffload.read(ref); // injected host function
//     // Or: const doc = offload.read('big');  // if offload is exposed as host utility
//     content.slice(0, 500);
//   `;
//   repl.eval(cell, { task: 'summarize big doc' });
//
//   // Real wiring would inject offload as a host capability into the VM sandbox,
//   // similar to how context.set/get are exposed in rlm/kernel/persistent-repl.js:23-27.
//   // The REPL output stays small: { result: '...', output: '' } instead of 50k tokens.
//
// How history.recent could feed Scope A's session-guidance section:
//
//   import { history } from '../context/offload/index.js';
//   import { ContextVariable } from '../rlm/kernel/context-variable.js';
//
//   // Scope A has ContextVariable + PersistentRepl (phase10-a-probe.mjs)
//   // Session-guidance is one of the context sources in server/src/context/sources/
//   function buildSessionGuidance(sessionId) {
//     const recent = history.recent(sessionId, 5);
//     // recent = [{id, parentId, kind, payload, ts}, ...]
//     const lines = recent.map(n => {
//       const text = n.payload?.text || JSON.stringify(n.payload);
//       return `- [${n.kind}] ${text.slice(0, 200)}`;
//     });
//     return `Recent history (${recent.length} turns):\n${lines.join('\n')}`;
//   }
//
//   // Then in ContextManager.build() or RLM context variable:
//   const ctxVar = new ContextVariable();
//   ctxVar.set('session-guidance', buildSessionGuidance('my-session'));
//   // Instead of dumping full 10-node history (e.g. 10k chars = 2500 tokens),
//   // guidance keeps 5 nodes ~1k chars = 250 tokens, 10x reduction.
//   // Offload reference would be even smaller: "offload:session-<id>" → ~10 tokens.

export default { offload, history, estimateTokens };
