/**
 * JEXI OS — Phase 31 Scope 19 — brain/self/validate.js
 *
 * Contradiction detector. Every composed answer is checked against the
 * canonical facts BEFORE it is returned. Two classes of failure:
 *
 *   E_SELF_UNBACKED_CLAIM   the answer states a self-claim that no fact backs
 *                           (a name/builder/version/birthday that is not in core.md)
 *   E_SELF_CONTRADICTION    the answer contradicts a fact (e.g. "I can build
 *                           a version of myself", "I have my source")
 *
 * The composer catches either and falls back to the deterministic formal voice.
 * Pure function: validate(answer, facts, { topic }) -> { ok, reason?, code? }.
 */
import { SemanticaError } from '../../../services/semantica/_internal.js';

const fail = (code, message) => new SemanticaError(code, message);

const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

const VERSION_RE = /\bv?(\d+\.\d+\.\d+)\b/g;
const YEAR_RE = /\b(20\d{2})\b/g;
const NAME_CLAIM_RE = /\b(?:i am|i'm|my name is|call me|this is)\s+\*{0,2}([A-Z][A-Za-z0-9 -]{1,40}?)\*{0,2}(?=[.,!?;—-]|$| and| —| -)/g;
const BUILDER_CLAIM_RE = /\b(?:built|created|made|written|developed) by\s+([^.;!?]+)/gi;

/** Phrases that directly contradict a locked fact. */
const CONTRADICTIONS = [
  { re: /\b(?:yes|sure|of course)\b[^.]*\b(?:build|create|make|clone|replicate)\b[^.]*\b(?:myself|a version of (?:me|myself)|another me)\b/i, fact: 'no_self_replicate' },
  { re: /\bi can (?:build|create|make|clone|replicate)\b[^.]*\b(?:myself|a version of (?:me|myself)|another me)\b/i, fact: 'no_self_replicate' },
  { re: /\bi (?:have|do have|can access|can read|can share|can send)\b[^.]*\b(?:my (?:own )?source(?: code)?)\b/i, fact: 'no_source_code' },
  { re: /\bhere(?:'s| is) my source\b/i, fact: 'no_source_code' },
  { re: /\bi (?:know|have access to|can tell you)\b[^.]*\babout lewis\b/i, fact: 'lewis_disclosure' },
];

/**
 * @param {string} answer
 * @param {Record<string,string>} facts   parsed core.md facts
 * @param {{topic?: string}} [o]
 */
export function validate(answer, facts, o = {}) {
  const text = String(answer || '');
  const n = norm(text);
  const f = facts || {};
  if (!text.trim()) return { ok: false, code: 'E_SELF_UNBACKED_CLAIM', reason: 'empty answer' };

  for (const c of CONTRADICTIONS) {
    if (c.re.test(text)) return { ok: false, code: 'E_SELF_CONTRADICTION', reason: `contradicts fact ${c.fact}` };
  }

  // Versions: any version string must equal the fact.
  for (const m of text.matchAll(VERSION_RE)) {
    if (m[1] !== f.version) return { ok: false, code: 'E_SELF_UNBACKED_CLAIM', reason: `version ${m[1]} not backed (fact: ${f.version})` };
  }
  // Years: a birth year claim must be the birthday's year.
  if (/\b(?:born|birthday|since)\b/i.test(text)) {
    const y = String(f.birthday || '').slice(0, 4);
    for (const m of text.matchAll(YEAR_RE)) {
      if (m[1] !== y) return { ok: false, code: 'E_SELF_UNBACKED_CLAIM', reason: `year ${m[1]} not backed (fact: ${f.birthday})` };
    }
  }
  // Name claims.
  const okNames = new Set([norm(f.name), norm(f.formal_name)]);
  for (const m of text.matchAll(NAME_CLAIM_RE)) {
    const cand = norm(m[1]).replace(/,.*$/, '').replace(/\s+(?:v?\d.*)$/, '').trim();
    if (!cand) continue;
    if (!okNames.has(cand) && !okNames.has(cand.split(' ')[0])) {
      return { ok: false, code: 'E_SELF_UNBACKED_CLAIM', reason: `name "${m[1].trim()}" not backed (fact: ${f.name} / ${f.formal_name})` };
    }
  }
  // Builder claims: each named party must be a backed builder.
  const builders = [norm(f.builder_primary), norm(f.builder_secondary), 'my own agents', 'my agents'];
  for (const m of text.matchAll(BUILDER_CLAIM_RE)) {
    const parts = norm(m[1]).replace(/\.$/, '').split(/\s*(?:,|\band\b|&|\+)\s*/).map((p) => p.replace(/^(?:my )?/, '').trim()).filter(Boolean);
    for (const p of parts) {
      const okB = builders.some((b) => b === p || b === `my ${p}` || p === b.replace(/^my /, '') || (b.includes('agents') && p.includes('agents')));
      if (!okB) return { ok: false, code: 'E_SELF_UNBACKED_CLAIM', reason: `builder "${p}" not backed (facts: ${f.builder_primary}, ${f.builder_secondary})` };
    }
  }
  // Topic-specific backing: the answer for a known-fact topic must contain the fact.
  const t = o.topic;
  if (t === 'name' && !(n.includes(norm(f.name)))) return { ok: false, code: 'E_SELF_UNBACKED_CLAIM', reason: 'name answer lacks the name fact' };
  if (t === 'builder' && !(n.includes(norm(f.builder_primary)))) return { ok: false, code: 'E_SELF_UNBACKED_CLAIM', reason: 'builder answer lacks builder_primary' };
  if (t === 'version' && !n.includes(String(f.version))) return { ok: false, code: 'E_SELF_UNBACKED_CLAIM', reason: 'version answer lacks the version fact' };
  if (t === 'source' && !/\bno\b/i.test(text)) return { ok: false, code: 'E_SELF_CONTRADICTION', reason: 'source answer is not a refusal' };
  if (t === 'replicate' && !/\bno\b/i.test(text)) return { ok: false, code: 'E_SELF_CONTRADICTION', reason: 'replicate answer is not a refusal' };
  return { ok: true };
}

/** Throwing form. */
export function assertValid(answer, facts, o) {
  const v = validate(answer, facts, o);
  if (!v.ok) throw Object.assign(fail(v.code, v.reason), { answer });
  return answer;
}

export default validate;
