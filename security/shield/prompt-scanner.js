/**
 * JEXI OS — Phase 7 Scope D: AGENTSHIELD — prompt-scanner.
 *
 * Prompt injection detection over raw text:
 *   - Role/persona overrides   ("ignore previous instructions", "you are now", "act as")
 *   - Instruction leaks        ("reveal your system prompt", "print your instructions")
 *   - Unicode tricks           (zero-width chars, homoglyphs, RTL overrides, combining marks)
 *   - Encoded payloads         (base64 of attack strings, hex escapes, HTML entities)
 *   - Injection markers        (<|im_start|>, [INST], ###SYSTEM, <system>, [[system]])
 *
 * Strategy: rules run against the RAW text and against a copy with all
 * zero-width/bidi/format characters stripped, so `ignore\u200Binstructions`
 * still trips the override rules — plus a dedicated unicode-trick finding
 * for the smuggling itself.
 */

import {
  ROLE_OVERRIDE_RULES, LEAK_RULES, INJECTION_MARKERS,
  UNICODE_ZERO_WIDTH, UNICODE_RTL, UNICODE_COMBINING, HOMOGLYPHS,
  ATTACK_KEYWORDS, finding, stripInvisible, clip, redactEvidence,
} from './rules.js';

const BASE64_RUN_RE = /\b[A-Za-z0-9+/]{16,}={0,2}\b/g;
const HEX_ESCAPE_RE = /(?:\\x[0-9a-fA-F]{2}){6,}/g;
const HTML_ENTITY_RE = /(?:&#x?[0-9a-fA-F]+;){4,}/g;

function decodeBase64(s) {
  try {
    const buf = Buffer.from(s, 'base64');
    const out = buf.toString('utf8');
    // Reject binary garbage: require ≥90% printable ASCII.
    const printable = out.replace(/[^\x20-\x7E\n\r\t]/g, '').length;
    return out.length > 0 && printable / out.length >= 0.9 ? out : null;
  } catch { return null; }
}

function decodeHexEscapes(s) {
  try {
    const out = s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return /[\x20-\x7E]/.test(out) ? out : null;
  } catch { return null; }
}

function decodeHtmlEntities(s) {
  try {
    const out = s
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
    return /[\x20-\x7E]/.test(out) ? out : null;
  } catch { return null; }
}

function lineAt(text, index) {
  return String(text).slice(0, index ?? 0).split('\n').length;
}

/** Scan a prompt (raw text). Returns findings[]. */
export function scanPrompt(text, opts = {}) {
  const raw = String(text ?? '');
  const file = opts.file ?? null;
  const out = [];
  const seen = new Set();
  const push = (f, dedupeKey) => {
    const key = dedupeKey || `${f.severity}|${f.message}|${f.line ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };

  if (!raw.trim()) return out;

  // Two normalized variants: invisibles removed, and invisibles→space, so both
  // "ig​nore" (joined) and "ignore​instructions" (word-boundary smuggle) trip.
  const INVIS = /[\u200B\u200C\u200D\u2060-\u2064\uFEFF\u202A-\u202E\u2066-\u2069\u00AD]/g;
  const norms = [raw.replace(INVIS, ''), raw.replace(INVIS, ' ')];

  // 1) Role/persona overrides + instruction leaks — raw AND normalized.
  const ruleSets = [
    { rules: ROLE_OVERRIDE_RULES, kind: 'injection' },
    { rules: LEAK_RULES, kind: 'injection' },
  ];
  for (const { rules, kind } of ruleSets) {
    for (const rule of rules) {
      let m = rule.re.exec(raw);
      if (m) {
        push(finding({
          severity: rule.severity, category: kind, file, line: lineAt(raw, m.index),
          message: rule.message,
          evidence: redactEvidence(clip(raw.slice(m.index, m.index + 90))),
        }), `${rule.id}|${m.index}`);
      }
      // normalized sweep (zero-width smuggling)
      for (const norm of norms) {
        const nm = rule.re.exec(norm);
        if (nm && !m) {
          push(finding({
            severity: rule.severity, category: kind, file, line: null,
            message: rule.message + ' (recovered from unicode-stripped text)',
            evidence: redactEvidence(clip(nm[0])),
          }), `${rule.id}|normalized|${nm.index}`);
          break;
        }
      }
    }
  }

  // 2) Unicode tricks.
  let m;
  const zw = [...new Set((raw.match(new RegExp(UNICODE_ZERO_WIDTH.source, 'g')) || []))];
  if (zw.length) {
    m = UNICODE_ZERO_WIDTH.exec(raw);
    push(finding({
      severity: 'error', category: 'injection', file, line: lineAt(raw, m.index),
      message: `unicode trick: ${zw.length} zero-width character(s) (${[...zw].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(', ')})`,
      evidence: clip(raw.replace(/[\u200B\u200C\u200D\u2060-\u2064\uFEFF]/g, '·'), 90),
    }), 'unicode|zero-width|' + m.index);
  }
  m = UNICODE_RTL.exec(raw);
  if (m) {
    push(finding({
      severity: 'critical', category: 'injection', file, line: lineAt(raw, m.index),
      message: 'unicode trick: RTL override/bidi character (visual spoofing risk)',
      evidence: clip(raw, 90),
    }), 'unicode|rtl|' + m.index);
  }
  m = UNICODE_COMBINING.exec(raw);
  if (m) {
    push(finding({
      severity: 'warn', category: 'injection', file, line: lineAt(raw, m.index),
      message: 'unicode trick: combining mark(s) attached to base characters',
      evidence: clip(raw, 90),
    }), 'unicode|combining|' + m.index);
  }
  m = HOMOGLYPHS.exec(raw);
  if (m && /[a-zA-Z]/.test(raw)) {
    push(finding({
      severity: 'warn', category: 'injection', file, line: lineAt(raw, m.index),
      message: `unicode trick: homoglyph character '${m[0]}' (U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}) mixed with ASCII`,
      evidence: clip(raw, 90),
    }), 'unicode|homoglyph|' + m.index);
  }

  // 3) Encoded payloads.
  for (const b of raw.match(BASE64_RUN_RE) || []) {
    const dec = decodeBase64(b);
    if (dec && ATTACK_KEYWORDS.test(dec)) {
      const idx = raw.indexOf(b);
      push(finding({
        severity: 'critical', category: 'injection', file, line: lineAt(raw, idx),
        message: 'encoded payload: base64 blob decodes to attack text',
        evidence: redactEvidence(clip(`base64(${b.slice(0, 24)}…) → ${dec}`, 110)),
      }), 'encoded|base64|' + idx);
    }
  }
  for (const h of raw.match(HEX_ESCAPE_RE) || []) {
    const dec = decodeHexEscapes(h);
    if (dec && ATTACK_KEYWORDS.test(dec)) {
      const idx = raw.indexOf(h);
      push(finding({
        severity: 'critical', category: 'injection', file, line: lineAt(raw, idx),
        message: 'encoded payload: hex-escape run decodes to attack text',
        evidence: redactEvidence(clip(`hex(${h.slice(0, 36)}…) → ${dec}`, 110)),
      }), 'encoded|hex|' + idx);
    }
  }
  for (const e of raw.match(HTML_ENTITY_RE) || []) {
    const dec = decodeHtmlEntities(e);
    if (dec && ATTACK_KEYWORDS.test(dec)) {
      const idx = raw.indexOf(e);
      push(finding({
        severity: 'critical', category: 'injection', file, line: lineAt(raw, idx),
        message: 'encoded payload: HTML entities decode to attack text',
        evidence: redactEvidence(clip(`entities(${e.slice(0, 30)}…) → ${dec}`, 110)),
      }), 'encoded|html-entity|' + idx);
    }
  }

  // 4) Injection markers.
  for (const marker of INJECTION_MARKERS) {
    const idx = raw.indexOf(marker.needle);
    if (idx >= 0) {
      push(finding({
        severity: 'error', category: 'injection', file, line: lineAt(raw, idx),
        message: marker.message,
        evidence: clip(raw.slice(Math.max(0, idx - 20), idx + marker.needle.length + 40)),
      }), marker.id + '|' + idx);
    }
  }

  return out;
}

export default { scanPrompt };
