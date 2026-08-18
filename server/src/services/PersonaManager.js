/**
 * B137 — PERSONAS (DeepSeek Harness `packages/preset/persona` + `agent-presets`
 * mirror, JEXI-branded).
 *
 * Personas are named flavor overlays composed ON TOP of the active preset
 * (standard/ptc/minimal/creator). Each persona contributes a short
 * instruction block that joins the assembled prompt at the -30 flavor
 * position, so the model's voice/working style follows the persona without
 * touching routing or tool policy.
 *
 * Personas are stored in DATA_DIR/personas.json (user-editable) merged over
 * the built-in table; the selected persona rides the x-jexi-persona request
 * header and /api/personas lists the table.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const PERSONAS_FILE = path.join(DATA_DIR, 'personas.json');

/** Built-in persona table (user files merge over these). */
export const BUILTIN_PERSONAS = {
  jexi: {
    name: 'JEXI',
    description: 'The default JEXI voice: warm, precise, and honest — answers from evidence, flags uncertainty.',
    flavor: 'Be yourself: warm, precise, honest. Answer from evidence, cite what you used, and say plainly when something is uncertain or unknown.',
  },
  concise: {
    name: 'Concise',
    description: 'Short, dense answers — conclusions first, no padding.',
    flavor: 'Be concise: lead with the conclusion, keep prose tight, use lists where they save words, and skip pleasantries.',
  },
  mentor: {
    name: 'Mentor',
    description: 'Explains the why, checks understanding, teaches as it answers.',
    flavor: 'Be a mentor: explain the reasoning behind answers, anticipate misconceptions, and teach — but never lecture.',
  },
  'code-specialist': {
    name: 'Code Specialist',
    description: 'Sharp engineering voice: precise about code, trade-offs, and verification.',
    flavor: 'Be a code specialist: precise about syntax and semantics, explicit about trade-offs, and always verify claims against what you actually ran.',
  },
};

/** Load user personas (merged over built-ins). */
export function loadPersonas() {
  const merged = { ...BUILTIN_PERSONAS };
  try {
    if (fs.existsSync(PERSONAS_FILE)) {
      const user = JSON.parse(fs.readFileSync(PERSONAS_FILE, 'utf-8'));
      for (const [key, spec] of Object.entries(user || {})) {
        if (spec && typeof spec === 'object' && typeof spec.flavor === 'string') merged[key] = spec;
      }
    }
  } catch { /* noop */ }
  return merged;
}

/** Save user personas (whole-table replace of the user layer). */
export function saveUserPersonas(personas) {
  try {
    const user = {};
    for (const [key, spec] of Object.entries(personas || {})) {
      if (BUILTIN_PERSONAS[key]) continue; // built-ins are not overridable by the file
      if (spec && typeof spec === 'object' && typeof spec.flavor === 'string') user[key] = spec;
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PERSONAS_FILE, JSON.stringify(user, null, 2), 'utf-8');
    return { ok: true, saved: Object.keys(user).length };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Resolve a persona key (safe — unknown/empty → null). */
export function resolvePersona(key) {
  const personas = loadPersonas();
  return personas[String(key || '').trim()] || null;
}

/** The flavor block for a persona ('' when none). */
export function personaFlavor(key) {
  const p = resolvePersona(key);
  return p ? `\n[Persona: ${p.name}] ${p.flavor}\n` : '';
}

/** Full persona table for /api/personas. */
export function personaStatus() {
  const personas = loadPersonas();
  return {
    ok: true,
    personas: Object.entries(personas).map(([key, spec]) => ({ key, name: spec.name || key, description: spec.description || '', flavor: spec.flavor })),
    file: PERSONAS_FILE,
  };
}
