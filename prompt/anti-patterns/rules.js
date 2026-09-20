// prompt/anti-patterns/rules.js
// Phase 25 — Scope L: the anti-pattern rule catalog + detectors.
//
// The immune system for the prompt itself: the same discipline the
// incidents layer (Scope H) applies to failures, applied to the prompt's
// structure and language. Every rule below is REAL detection over the
// built prompt's sections — no stubs, no placeholders.
//
// Finding shape (contract):
//   { ruleId, severity, location, message, evidence }
//   - severity: 'error' | 'warn' | 'info' (DEFAULT_SEVERITIES below)
//   - location: { section, charOffset } for single-section findings
//               { sections: [ids...], charOffset } for cross-section
//               findings (duplicate / conflict); charOffset is the 0-based
//               offset of the evidence inside the named section's content
//   - evidence: the offending substring (or a deterministic excerpt for
//               whole-section findings)
//
// Determinism (RULE 3): rules run in catalog order; within a rule,
// sections in order, matches left to right. Same prompt -> same findings,
// same order, byte for byte. No timestamps anywhere in findings.
//
// False positives (RULE 4): phrase lists are matched with word boundaries
// and literal phrasing; the only whole-word flag is "consider" (documented
// in catalog.md). Fuzzy judgment calls are capped at 'warn' — the lead's
// explicit severity table wins where it is pinned.
//
// Zone discipline: prompt/versioning is READ-ONLY imported (normalizeBuiltPrompt
// — the same built-prompt definition versioning snapshots, so lint and
// versioning always agree on what a prompt is). No other zone touched.

/** Severity ladder (RULE 1: only 'error' blocks; warn/info do not). */
export const SEVERITIES = Object.freeze(['error', 'warn', 'info']);

/** Lead-specified default severities for the 9 rules. */
export const DEFAULT_SEVERITIES = Object.freeze({
  'AP-GOD-PROMPT': 'error',
  'AP-VAGUE': 'warn',
  'AP-BRANCHING-PROSE': 'warn',
  'AP-HARDCODED': 'warn',
  'AP-FLATTERY': 'error',
  'AP-SOFT-CONSTRAINT': 'error',
  'AP-NO-TERMINATION': 'warn',
  'AP-DUPLICATE': 'warn',
  'AP-CONFLICT': 'error',
});

/** Machine-readable codes for the anti-patterns zone (Scope L). */
export const ANTI_PATTERN_CODES = Object.freeze({
  INVALID_PROMPT: 'E_INVALID_PROMPT',
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function excerpt(s, n = 120) {
  const t = String(s);
  return t.length <= n ? t : t.slice(0, n) + '...';
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-boundary regex for a phrase; boundaries only where the phrase has word chars. */
function phraseRegex(phrase, flags = 'gi') {
  const pre = /^\w/.test(phrase) ? '\\b' : '';
  const post = /\w$/.test(phrase) ? '\\b' : '';
  return new RegExp(pre + escapeRegExp(phrase) + post, flags);
}

function makeFinding(ruleId, location, message, evidence) {
  return {
    ruleId,
    severity: DEFAULT_SEVERITIES[ruleId],
    location,
    message,
    evidence,
  };
}

/** Scan every section with every regex; one finding per occurrence, in order. */
function scanRegexes(ruleId, sections, regexes, messageFn) {
  const findings = [];
  for (const sec of sections) {
    for (const re of regexes) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(sec.content)) !== null) {
        if (m.index === re.lastIndex) re.lastIndex++; // zero-length guard
        findings.push(
          makeFinding(
            ruleId,
            { section: sec.id, charOffset: m.index },
            messageFn(sec, m[0]),
            excerpt(m[0], 160)
          )
        );
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// AP-GOD-PROMPT — one section > 50% of total prompt chars
// ---------------------------------------------------------------------------
function detectGodPrompt(ctx) {
  const { sections, totalChars } = ctx;
  if (sections.length < 2 || totalChars === 0) return []; // single section is trivially 100% of itself
  const findings = [];
  for (const sec of sections) {
    const pct = (sec.content.length / totalChars) * 100;
    if (pct > 50) {
      findings.push(
        makeFinding(
          'AP-GOD-PROMPT',
          { section: sec.id, charOffset: 0 },
          `section "${sec.id}" consumes ${pct.toFixed(1)}% of the prompt (${sec.content.length}/${totalChars} chars), over the 50% threshold`,
          excerpt(sec.content, 100)
        )
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// AP-VAGUE — vague instruction language
// ---------------------------------------------------------------------------
const VAGUE_PHRASES = Object.freeze([
  'use appropriate',
  'when needed',
  'if applicable',
  'as necessary',
  'where possible',
]);

function detectVague(ctx) {
  return scanRegexes(
    'AP-VAGUE',
    ctx.sections,
    VAGUE_PHRASES.map((p) => phraseRegex(p)),
    (sec, hit) => `vague instruction language "${hit}" in section "${sec.id}" - state the concrete rule instead`
  );
}

// ---------------------------------------------------------------------------
// AP-BRANCHING-PROSE — branching logic stated in prose
// ---------------------------------------------------------------------------
const BRANCHING_REGEXES = Object.freeze([
  /\bif\b[^.!?\n]*\bthen\b/gi, // "if X then Y (else Z)"
  /\bin the case that\b/gi,
  /\bdepending on\b/gi,
]);

function detectBranching(ctx) {
  return scanRegexes(
    'AP-BRANCHING-PROSE',
    ctx.sections,
    BRANCHING_REGEXES,
    (sec, hit) => `branching stated in prose ("${excerpt(hit, 60)}") in section "${sec.id}" - express branches as explicit rules or a decision table`
  );
}

// ---------------------------------------------------------------------------
// AP-HARDCODED — hardcoded values that should be variables
// ---------------------------------------------------------------------------
const HARDCODED_REGEXES = Object.freeze([
  [/\bgpt-?\d(?:\.\d+)?[a-z]*/gi, 'model name'],
  [/\bclaude(?:[- ]?(?:\d(?:\.\d)?|sonnet|opus|haiku|instant))?\b/gi, 'model name'],
  [/\bgemini(?:[- ]?\d(?:\.\d)?)?\b/gi, 'model name'],
  [/\bllama[- ]?\d/gi, 'model name'],
  [/\bmistral\b/gi, 'model name'],
  [/\bqwen\b/gi, 'model name'],
  [/\bdeepseek\b/gi, 'model name'],
  [/\/(?:home|root|usr|var|etc|opt|tmp|srv|mnt|Users)\/[\w.\-/]*(?<!\.)/g, 'absolute file path'],
  [/\b[A-Z]:\\[\w.\-\\]*(?<!\.)/g, 'windows file path'],
  [/\b\d{3,}\b/g, 'magic number'],
  [/\b0\.\d+\b/g, 'magic number'],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'hardcoded credential'],
]);

function detectHardcoded(ctx) {
  const findings = [];
  for (const sec of ctx.sections) {
    for (const [re, label] of HARDCODED_REGEXES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(sec.content)) !== null) {
        if (m.index === re.lastIndex) re.lastIndex++;
        findings.push(
          makeFinding(
            'AP-HARDCODED',
            { section: sec.id, charOffset: m.index },
            `hardcoded ${label} "${m[0]}" in section "${sec.id}" - move it to configuration or a variable`,
            m[0]
          )
        );
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// AP-FLATTERY — flattery openers
// ---------------------------------------------------------------------------
const FLATTERY_PHRASES = Object.freeze([
  'great question',
  'excellent point',
  'certainly!',
  'of course!',
]);

function detectFlattery(ctx) {
  return scanRegexes(
    'AP-FLATTERY',
    ctx.sections,
    FLATTERY_PHRASES.map((p) => phraseRegex(p)),
    (sec, hit) => `flattery opener "${hit}" in section "${sec.id}" - replace with the substantive response`
  );
}

// ---------------------------------------------------------------------------
// AP-SOFT-CONSTRAINT — soft language in constraints
// ---------------------------------------------------------------------------
const SOFT_PHRASES = Object.freeze(['should try', 'prefer to', 'when possible', 'consider']);

function detectSoftConstraint(ctx) {
  return scanRegexes(
    'AP-SOFT-CONSTRAINT',
    ctx.sections,
    SOFT_PHRASES.map((p) => phraseRegex(p)),
    (sec, hit) => `soft constraint language "${hit}" in section "${sec.id}" - rewrite as an imperative (do / never / refuse)`
  );
}

// ---------------------------------------------------------------------------
// AP-NO-TERMINATION — doing-tasks section without a termination condition
// ---------------------------------------------------------------------------
const TERMINATION_RE =
  /\b(until|done|complet\w*|finish\w*|stop\w*|terminat\w*|exit criteria|definition of done|hand[- ]?off)\b/i;

function detectNoTermination(ctx) {
  const findings = [];
  for (const sec of ctx.sections) {
    if (!/\bdoing\b|\btasks?\b/i.test(sec.id)) continue; // rule targets the doing-tasks section
    if (!TERMINATION_RE.test(sec.content)) {
      findings.push(
        makeFinding(
          'AP-NO-TERMINATION',
          { section: sec.id, charOffset: 0 },
          `doing-tasks section "${sec.id}" states no termination condition - say when the work is done (e.g. "report when all steps are complete")`,
          excerpt(sec.content, 120)
        )
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// AP-DUPLICATE — the same rule (normalized line) in two or more sections
// ---------------------------------------------------------------------------
function normalizeRuleLine(line) {
  return String(line)
    .trim()
    .toLowerCase()
    .replace(/^[-*•\d.)\s]+/, '') // strip bullets / list numbering
    .replace(/[.;:]+$/, '')
    .replace(/\s+/g, ' ');
}

function detectDuplicate(ctx) {
  const byKey = new Map(); // key -> { line, hits: [{ section, charOffset }] }
  for (const sec of ctx.sections) {
    for (const raw of sec.content.split('\n')) {
      const key = normalizeRuleLine(raw);
      if (key.length < 12) continue; // headings/short fragments are not rules
      const charOffset = sec.content.indexOf(raw);
      if (!byKey.has(key)) byKey.set(key, { line: raw.trim(), hits: [] });
      byKey.get(key).hits.push({ section: sec.id, charOffset });
    }
  }
  const findings = [];
  for (const { line, hits } of byKey.values()) {
    const sectionIds = [...new Set(hits.map((h) => h.section))];
    if (sectionIds.length < 2) continue; // cross-section duplication only
    findings.push(
      makeFinding(
        'AP-DUPLICATE',
        { sections: sectionIds, charOffset: hits[1].charOffset },
        `rule appears in ${sectionIds.length} sections [${sectionIds.join(', ')}] - keep one canonical copy and reference it`,
        excerpt(line, 160)
      )
    );
  }
  return findings;
}

// ---------------------------------------------------------------------------
// AP-CONFLICT — "always X" vs "never X"
// ---------------------------------------------------------------------------
const ALWAYS_RE = /\balways\s+([^\n.!?;]+)/gi;
const NEVER_RE = /\bnever\s+([^\n.!?;]+)/gi;

function normalizePredicate(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectPredicates(sections, re) {
  const out = [];
  for (const sec of sections) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(sec.content)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++;
      out.push({ section: sec.id, charOffset: m.index, pred: normalizePredicate(m[1]) });
    }
  }
  return out;
}

function detectConflict(ctx) {
  const always = collectPredicates(ctx.sections, ALWAYS_RE);
  const never = collectPredicates(ctx.sections, NEVER_RE);
  const findings = [];
  const seen = new Set();
  for (const a of always) {
    for (const n of never) {
      if (a.pred.length === 0 || a.pred !== n.pred) continue;
      const key = `${a.section}:${a.charOffset}|${n.section}:${n.charOffset}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(
        makeFinding(
          'AP-CONFLICT',
          { sections: [a.section, n.section], charOffset: n.charOffset },
          `contradiction: "always ${a.pred}" and "never ${n.pred}" both appear - exactly one can hold`,
          `"always ${a.pred}" (${a.section}) vs "never ${n.pred}" (${n.section})`
        )
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Catalog (order = execution order; deterministic, RULE 3)
// ---------------------------------------------------------------------------
export const RULES = Object.freeze([
  Object.freeze({
    id: 'AP-GOD-PROMPT',
    severity: DEFAULT_SEVERITIES['AP-GOD-PROMPT'],
    description: 'one section consumes more than 50% of the total prompt char budget',
    detect: detectGodPrompt,
  }),
  Object.freeze({
    id: 'AP-VAGUE',
    severity: DEFAULT_SEVERITIES['AP-VAGUE'],
    description:
      'vague phrases in instructions: "use appropriate", "when needed", "if applicable", "as necessary", "where possible"',
    detect: detectVague,
  }),
  Object.freeze({
    id: 'AP-BRANCHING-PROSE',
    severity: DEFAULT_SEVERITIES['AP-BRANCHING-PROSE'],
    description:
      'branching logic stated in prose: "if X then Y else Z", "in the case that", "depending on"',
    detect: detectBranching,
  }),
  Object.freeze({
    id: 'AP-HARDCODED',
    severity: DEFAULT_SEVERITIES['AP-HARDCODED'],
    description:
      'hardcoded values that should be variables: specific model names, specific file paths, magic numbers in instructions',
    detect: detectHardcoded,
  }),
  Object.freeze({
    id: 'AP-FLATTERY',
    severity: DEFAULT_SEVERITIES['AP-FLATTERY'],
    description: 'flattery openers: "Great question", "Excellent point", "Certainly!", "Of course!"',
    detect: detectFlattery,
  }),
  Object.freeze({
    id: 'AP-SOFT-CONSTRAINT',
    severity: DEFAULT_SEVERITIES['AP-SOFT-CONSTRAINT'],
    description: 'soft language in constraints: "should try", "prefer to", "when possible", "consider"',
    detect: detectSoftConstraint,
  }),
  Object.freeze({
    id: 'AP-NO-TERMINATION',
    severity: DEFAULT_SEVERITIES['AP-NO-TERMINATION'],
    description: 'no termination condition stated in a doing-tasks section',
    detect: detectNoTermination,
  }),
  Object.freeze({
    id: 'AP-DUPLICATE',
    severity: DEFAULT_SEVERITIES['AP-DUPLICATE'],
    description: 'same rule appearing in two sections',
    detect: detectDuplicate,
  }),
  Object.freeze({
    id: 'AP-CONFLICT',
    severity: DEFAULT_SEVERITIES['AP-CONFLICT'],
    description: 'two rules that contradict (e.g. "always X" and "never X")',
    detect: detectConflict,
  }),
]);
