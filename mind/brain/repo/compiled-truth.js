/**
 * JEXI OS — Phase 28 Scope A — brain repo: compiled truth.
 *
 * "Compiled truth + timeline" pattern (gbrain): the Compiled Truth section is
 * the CURRENT BEST understanding — replaceable as knowledge improves — while
 * the Timeline is the append-only evidence ledger. compile() returns both
 * views of a page without mutating it.
 */
import { SemanticaError } from '../../semantica/_internal.js';

/**
 * Compile a page into its two canonical views.
 * @returns {{ compiledTruth: string, timeline: {when,entry,seq}[] }}
 */
export function compilePage(page) {
  return {
    compiledTruth: page.compiledTruth.trim() === '' ? '(none yet)' : page.compiledTruth.trim(),
    timeline: page.timeline.map((e) => ({ when: e.when, entry: e.entry, seq: e.seq })),
  };
}

/** Replace the compiled truth (the ONLY replaceable section; timeline untouched). */
export function withCompiledTruth(page, compiledTruth, { now }) {
  if (typeof compiledTruth !== 'string') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `compiledTruth must be a string, got ${typeof compiledTruth}`);
  }
  return { ...page, compiledTruth: compiledTruth.trim(), updated_at: now };
}
