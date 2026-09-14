/**
 * JEXI OS — SKILLS subsystem (Phase 4, Scope B).
 *
 * Progressive-disclosure skills:
 *   catalog  — metadata index loaded at startup (frontmatter only)
 *   loader   — read_skill on demand (full body + scripts/resources)
 *   curator  — second-pass lifecycle: dedupe, staleness, archive
 *
 *   const skills = await import('./skills/index.js');
 *   const index = await skills.catalog();            // { slug: meta }
 *   const full = skills.readSkill('debugging');      // full content
 *   const verdict = skills.reviewDraft(draft);       // curator gate
 */
export * from './catalog.js';
export * from './loader.js';
export * from './curator.js';
export * from './executor.js';