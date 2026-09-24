'use strict';

/*
 * verification/eval/gate.js
 * Static gate over the source files an eval touches.
 *   - static source digests: sha256 of every source file
 *   - syntactic warnings: dangerous calls (the eval builtin, the exec
 *     family, the Function constructor, dynamic require forms) and
 *     unicode tricks (zero-width chars, bidi overrides, combining-mark
 *     runs) in generated code
 *
 * Output: { sources: [{ path, sha256 }], warnings: [{ file, line, rule, message, evidence? }] }
 *
 * Warnings are syntactic only - they do not fail the gate; the receipt
 * carries them so a reviewer can see exactly what the evaluated source
 * contains. Regexes are built from escaped strings so this scanner
 * never flags its own source lines.
 */

const fs = require('fs');
const path = require('path');
const { sha256 } = require('./rules');

const DANGEROUS_CALLS = [
  { rule: 'eval-call',       re: new RegExp('(^|[^\\w])eval\\s*\\(') },
  { rule: 'exec-call',       re: new RegExp('(^|[^\\w.])(exec|execSync)\\s*\\(') },
  { rule: 'function-ctor',   re: new RegExp('\\bnew\\s+Function\\s*\\(') },
  { rule: 'dynamic-require', re: new RegExp('\\brequire\\s*\\(\\s*[^\'"\\(]') },
];

const UNICODE_TRICKS = [
  { rule: 'zero-width-char',     re: new RegExp('[\\u200B-\\u200F\\u2060-\\u2064\\uFEFF]') },
  { rule: 'bidi-override',       re: new RegExp('[\\u202A-\\u202E\\u2066-\\u2069]') },
  { rule: 'combining-marks-run', re: new RegExp('[\\u0300-\\u036F]{5,}') },
];

function gateSource(source, meta) {
  const warnings = [];
  const lines = String(source).split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const { rule, re } of DANGEROUS_CALLS) {
      if (re.test(line)) {
        warnings.push({
          file: meta.file,
          line: idx + 1,
          rule,
          message: 'syntactic warning: ' + rule + ' in generated code',
          evidence: line.trim().slice(0, 160),
        });
      }
    }
    for (const { rule, re } of UNICODE_TRICKS) {
      if (re.test(line)) {
        warnings.push({
          file: meta.file,
          line: idx + 1,
          rule,
          message: 'unicode trick: ' + rule,
        });
      }
    }
  });
  return warnings;
}

function runGate(files) {
  const sources = [];
  const warnings = [];
  for (const f of files) {
    const abs = path.resolve(f);
    const src = fs.readFileSync(abs, 'utf8');
    sources.push({ path: abs, sha256: sha256(src) });
    for (const w of gateSource(src, { file: abs })) warnings.push(w);
  }
  return { sources, warnings };
}

module.exports = { runGate, gateSource, DANGEROUS_CALLS, UNICODE_TRICKS };
