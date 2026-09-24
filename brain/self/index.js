/**
 * JEXI OS — Phase 31 Scope 19 — brain/self — public API.
 *
 *   self.facts()                  canonical facts (frozen) + PROV-O + sha256
 *   self.identityBlock()          the prompt identity section text (from core.md, never hardcoded)
 *   self.answer(q, opts)          compose a self-answer (voice + rotation + validation)
 *   self.classify(q)              self-topic or null
 *   self.route(q)                 three-bucket routing
 *   self.reflex(seams)            orchestration reflex over injected seams
 *   self.guard                    immutable guard (assertWritable / E_SELF_IMMUTABLE)
 *   self.validate(answer, facts)  contradiction detector
 *   self.session()                new rotation state
 *
 * No server imports. Consumers: server/src/wiring/phase31-bootstrap.js
 * (registration) and server/src/services/JexiIdentity.js (facts seam).
 */
import { guard, loadCore, CORE_PATH, VOICES_PATH, FACT_KEYS } from './guard.js';
import { compose, classify, createSession, pickVoice, VOICES, TOPICS } from './composer.js';
import { validate, assertValid } from './validate.js';
import { createReflex, route, needsVerification, refine } from './reflex.js';

let cached = null;
export function facts({ reload = false } = {}) {
  if (!cached || reload) cached = loadCore();
  return cached;
}

/** Identity section for the system prompt. Every value comes from core.md. */
export function identityBlock() {
  const { facts: f, sha256 } = facts();
  return [
    `You are ${f.name} (${f.formal_name}), version ${f.version}, born ${f.birthday}.`,
    `Built by ${f.builder_primary} and ${f.builder_secondary}.`,
    `Purpose: ${f.purpose}.`,
    `Origin: ${f.origin_summary}`,
    `Boundaries: ${f.lewis_disclosure} ${f.no_source_code} ${f.no_self_replicate}`,
    'Answer self-questions with exactly the fact asked, short and warm; elaborate only when asked. Never name an agent — say "I".',
    `<!-- source: brain/self/core.md sha256:${sha256.slice(0, 12)} -->`,
  ].join('\n');
}

export const self = Object.freeze({
  facts, identityBlock,
  answer: compose, classify, pickVoice, session: createSession,
  route, needsVerification, refine, reflex: createReflex,
  validate, assertValid,
  guard, CORE_PATH, VOICES_PATH, FACT_KEYS, VOICES, TOPICS,
});
export { compose, classify, createSession, validate, assertValid, createReflex, route, guard, loadCore, CORE_PATH, FACT_KEYS, VOICES, TOPICS };
export default self;
