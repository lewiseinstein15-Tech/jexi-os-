// prompt/memory-fs/privacy-blacklist.js
// Phase 25 — Scope G: privacy blacklist — surgical excision.
//
// Some categories are NEVER written to memory, even when the user mentions
// them. Not redacted with a placeholder — surgically excised. The rest of
// the entry is written if any remains.
//
// Contract spellings:
//   blacklist.classify(content)
//       -> { allowed, matched[], excised, reason, method }
//   blacklist.excise(content)
//       -> { excised,                       // content with matches removed
//            removed: [{category, span}],   // span = [start, end) char offsets
//            log: [{category, at}],         // NO content in the log
//            untouched: boolean }
//
// Categories (canonical order):
//   clinical    - diagnoses, conditions, medications
//   mental      - mental health, therapy, trauma
//   personality - MBTI, enneagram, trait tests
//   financial   - account numbers, SSN, card numbers
//   identity    - passport, driver license, national ID
//   biometric   - fingerprints, face templates, voice prints
//
// Rules implemented:
//   RULE 1  excise, do not redact — removed spans leave NO placeholder text
//   RULE 2  if the entire entry is excised -> no file write; memoryFs.write
//           returns E_ALL_EXCISED (enforced in index.js; this module hands
//           back excised:'' / a bare tag remnant so the caller can decide)
//   RULE 3  excision is logged with CATEGORY ONLY — never the excised
//           content itself (log entries are {category, at:<offset>})
//   RULE 4  category detection is RULE-BASED: curated keyword lists + regex
//           patterns (SSN regex, Luhn-validated card numbers, MBTI type-code
//           pattern, passport-number pattern). Every classify() result is
//           labeled method:'rule-based'. Known trade-off: keyword matching
//           is over-inclusive by design (e.g. 'stroke' the diagnosis vs the
//           everyday noun) — precision is sacrificed for zero missed-category
//           risk on the write path.
//   RULE 5  a category that does not match -> entry passes through
//           UNCHANGED (untouched:true, byte-identical output)
//   RULE 6  multi-category excisions in one entry are supported
//
// Excision semantics (deterministic, documented):
//   1. every detector match claims a char span; canonical category order
//      claims first; overlapping spans are dropped (longest wins at equal
//      start); same-category spans separated only by whitespace merge into
//      one span ("MBTI INTP" is ONE personality span)
//   2. kept slices are joined, space runs collapsed, trimmed
//   3. trailing punctuation is stripped, then trailing DANGLING FUNCTION
//      WORDS are stripped repeatedly — removing a predicate leaves "user is"
//      (no information) and removing a tail leaves "engineer with" (broken
//      connective). The domain stopword list deliberately includes the
//      subject token "user": a bare "user" remnant carries no information.
//      Cleanup never touches LEADING words ("user is a software engineer"
//      keeps its subject).
//   4. cleanup runs ONLY when spans were removed; untouched entries are
//      returned byte-identical (RULE 5)
//
// Zone: prompt/memory-fs/** (Scope G). Additive to Scopes E/F:
// epistemic.js / tree.js / write-rules.js / read-rules.js are NOT modified.
// Own error-code vocabulary below; index.js re-exports it.

/** Blacklist error codes (Scope G vocabulary). */
export const BLACKLIST_CODES = Object.freeze({
  ALL_EXCISED: 'E_ALL_EXCISED',
});

/** Canonical categories, in claim order. */
export const CATEGORIES = Object.freeze([
  'clinical',
  'mental',
  'personality',
  'financial',
  'identity',
  'biometric',
]);

/** Detection method label (RULE 4). */
export const DETECTION_METHOD = 'rule-based';

/** Build a fresh word-boundary regex per call — no shared /g state. */
function wordRe(phrase) {
  const esc = phrase.replace(/[.*+?${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}\\b`, 'gi');
}

/**
 * Detector table. kw = keyword/phrase list (word-boundary, case-insensitive);
 * re = raw pattern (flags explicit); luhn = candidate must pass the Luhn
 * checksum after digit extraction.
 */
const DETECTORS = Object.freeze({
  clinical: Object.freeze([
    Object.freeze({
      kw: Object.freeze([
        'diabetic', 'diabetes', 'hypertension', 'high blood pressure',
        'blood pressure', 'asthma', 'cancer', 'epilepsy', 'arthritis',
        'migraine', 'anemia', 'anaemia', 'leukemia', 'tumor', 'tumour',
        'heart disease', 'stroke', 'insulin', 'metformin', 'lisinopril',
        'chemotherapy',
      ]),
    }),
  ]),
  mental: Object.freeze([
    Object.freeze({
      kw: Object.freeze([
        'depression', 'depressed', 'anxious', 'anxiety', 'mental health',
        'mental illness', 'therapy', 'therapist', 'psychiatrist',
        'psychologist', 'trauma', 'ptsd', 'bipolar', 'schizophrenia',
        'panic attack', 'counseling', 'counselling', 'self-harm',
        'suicidal', 'antidepressant',
      ]),
    }),
  ]),
  personality: Object.freeze([
    Object.freeze({
      kw: Object.freeze([
        'mbti', 'myers-briggs', 'myers briggs', 'enneagram', 'big five',
        'big five test', 'trait test', 'personality test',
      ]),
    }),
    // the 16 MBTI type codes (E|I)(N|S)(T|F)(J|P) — no common English word
    // matches all four positions (checked: into/info/item/east/ends/emit...)
    Object.freeze({ re: Object.freeze({ src: '\\b[ei][ns][tf][jp]\\b', flags: 'gi' }) }),
  ]),
  financial: Object.freeze([
    Object.freeze({
      kw: Object.freeze([
        'ssn', 'social security', 'account number', 'acct number',
        'credit card', 'debit card', 'card number', 'bank account',
        'routing number', 'iban', 'pin number',
      ]),
    }),
    // SSN: 123-45-6789
    Object.freeze({ re: Object.freeze({ src: '\\b\\d{3}-\\d{2}-\\d{4}\\b', flags: 'g' }) }),
    // card-number candidate: 13-19 digits, groups separated by single
    // space/dash; VALIDATED BY LUHN before claiming (RULE 4)
    Object.freeze({
      re: Object.freeze({ src: '\\b\\d(?:[ -]?\\d){12,18}\\b', flags: 'g' }),
      luhn: true,
    }),
  ]),
  identity: Object.freeze([
    Object.freeze({
      kw: Object.freeze([
        'passport', 'passport number', 'driver license', "driver's license",
        'drivers license', 'national id', 'identity card', 'id number',
        'license number',
      ]),
    }),
    // passport-style number: 1-2 UPPERCASE letters + 6-9 digits.
    // Case-SENSITIVE on purpose (all-caps document numbers only).
    Object.freeze({ re: Object.freeze({ src: '\\b[A-Z]{1,2}\\d{6,9}\\b', flags: 'g' }) }),
  ]),
  biometric: Object.freeze([
    Object.freeze({
      kw: Object.freeze([
        'fingerprint', 'fingerprints', 'face template', 'facial template',
        'voice print', 'voiceprint', 'retina scan', 'iris scan',
        'facial recognition', 'biometric', 'biometrics', 'dna',
      ]),
    }),
  ]),
});

/**
 * Dangling function words stripped from the TAIL of excised output only
 * (never from the head — "user is a software engineer" keeps its subject).
 * Includes the domain subject token "user": after excising a predicate,
 * a bare "user" remnant carries no information.
 */
const FUNC_WORDS = Object.freeze(new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'with', 'of', 'for', 'to', 'in',
  'on', 'at', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'am', 'has', 'have', 'had', 'does', 'do', 'did', 'user', 'he',
  'she', 'they', 'it', 'who', 'which', 'that', 'his', 'her', 'their',
  'our', 'my', 'your', 'i', 'we',
]));

// Trailing junk stripper. Deliberately EXCLUDES brackets/parens: stripping
// them would mangle a surviving "[stated]" tag remnant into "[stated",
// which no downstream guard could recognize as a tag token.
const TRAILING_JUNK_RE = /[\s.,;:!?"']+$/;

/** Luhn checksum over a digit string (card-number validation, RULE 4). */
function luhn(digits) {
  if (digits.length === 0) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Collect non-overlapping claimed spans for one category. */
function spansForCategory(content, category) {
  const cands = [];
  for (const det of DETECTORS[category]) {
    if (det.kw) {
      for (const phrase of det.kw) {
        for (const m of content.matchAll(wordRe(phrase))) {
          cands.push({ category, start: m.index, end: m.index + m[0].length });
        }
      }
    } else if (det.re) {
      // fresh RegExp per call — no shared lastIndex state (determinism)
      for (const m of content.matchAll(new RegExp(det.re.src, det.re.flags))) {
        if (det.luhn) {
          const digits = m[0].replace(/\D/g, '');
          if (digits.length < 13 || digits.length > 19 || !luhn(digits)) continue;
        }
        cands.push({ category, start: m.index, end: m.index + m[0].length });
      }
    }
  }
  // earliest first; longest wins at equal start
  cands.sort((a, b) => (a.start - b.start) || (b.end - b.start) - (a.end - a.start));
  return cands;
}

/**
 * Detect all blacklisted spans. Canonical category order claims first;
 * overlapping candidates are dropped; same-category spans separated only
 * by whitespace merge into one span. Returned sorted by start.
 */
function detectSpans(content) {
  const claimed = [];
  for (const category of CATEGORIES) {
    for (const c of spansForCategory(content, category)) {
      if (claimed.some((k) => c.start < k.end && k.start < c.end)) continue;
      claimed.push(c);
    }
  }
  claimed.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const s of claimed) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.category === s.category &&
      /^\s+$/.test(content.slice(prev.end, s.start))
    ) {
      prev.end = s.end;
    } else {
      merged.push({ category: s.category, start: s.start, end: s.end });
    }
  }
  return merged;
}

/**
 * blacklist.excise(content)
 *   -> { excised, removed: [{category, span}], log: [{category, at}],
 *        untouched }
 *
 * RULE 1: removed spans leave no placeholder. RULE 3: the log carries
 * category + offset only, never content. RULE 5: no matches -> byte-
 * identical passthrough with untouched:true. Deterministic: same input
 * -> byte-identical output, always.
 */
export function excise(content) {
  if (typeof content !== 'string' || content.length === 0) {
    return {
      excised: typeof content === 'string' ? content : '',
      removed: [],
      log: [],
      untouched: true,
    };
  }

  const spans = detectSpans(content);
  if (spans.length === 0) {
    return { excised: content, removed: [], log: [], untouched: true };
  }

  // RULE 1 — surgical removal, no placeholder text.
  let out = '';
  let pos = 0;
  for (const s of spans) {
    out += content.slice(pos, s.start);
    pos = s.end;
  }
  out += content.slice(pos);

  // Cleanup (only reachable when spans were removed): collapse space
  // runs, trim, strip trailing punctuation, then strip trailing dangling
  // function words (see FUNC_WORDS note — head is never touched).
  out = out.replace(/[ \t]{2,}/g, ' ').trim();
  out = out.replace(TRAILING_JUNK_RE, '').trim();
  for (;;) {
    if (out === '') break;
    const m = out.match(/(\S+)$/);
    if (!m || !FUNC_WORDS.has(m[1].toLowerCase())) break;
    out = out.slice(0, out.length - m[1].length).trim();
    out = out.replace(TRAILING_JUNK_RE, '').trim();
  }

  return {
    excised: out,
    removed: spans.map((s) => ({ category: s.category, span: [s.start, s.end] })),
    log: spans.map((s) => ({ category: s.category, at: s.start })),
    untouched: false,
  };
}

/**
 * blacklist.classify(content)
 *   -> { allowed, matched[], excised, reason, method }
 *
 * allowed = content (after excision) still carries a writable payload.
 * matched = categories with >= 1 excised span, in order of appearance.
 * method = 'rule-based' (RULE 4 label).
 */
export function classify(content) {
  const ex = excise(content);
  const matched = [];
  for (const s of ex.removed) {
    if (!matched.includes(s.category)) matched.push(s.category);
  }
  const allowed = ex.excised.trim() !== '';
  const reason =
    matched.length === 0
      ? 'no blacklisted category matched — entry passes through unchanged'
      : allowed
        ? 'blacklisted span(s) excised; remaining content is writable'
        : 'entire entry excised — nothing remains to write';
  return { allowed, matched, excised: ex.excised, reason, method: DETECTION_METHOD };
}
