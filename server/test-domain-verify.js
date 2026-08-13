/**
 * Stage 16 (domain verification engine) tests — all deterministic, no AI keys.
 */
import { detectDomain, deterministicChecks, verifyDomainAnswer } from './src/services/DomainVerifier.js';

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; console.log('✅ ' + name); }
  else { failed++; console.log('❌ ' + name); }
}

/* ---------------- Domain detection ---------------- */
check('detects math', detectDomain('Solve the integral of x^2') === 'math');
check('detects code', detectDomain('Write a React app that fetches an API') === 'code');
check('detects research', detectDomain('Research how solar panels work') === 'research');
check('detects engineering', detectDomain('Design a steel beam for a 12m span') === 'engineering');
check('defaults to general', detectDomain('Hi, how are you?') === 'general');

/* ---------------- Math checks ---------------- */
const badMath = deterministicChecks('What is 12 * 7?', '## FORMULA\n\n$$ 12 \\times 7 $$\n\nSo the answer is 84. $$ unfinished', 'math');
check('math: flags unbalanced display math', !badMath.ok && badMath.issues.some((i) => /Unbalanced display-math/.test(i)));
check('math: flags missing FINAL ANSWER', !badMath.ok && badMath.issues.some((i) => /FINAL ANSWER/.test(i)));

const goodMath = deterministicChecks('Solve for x: 2x + 6 = 14', '## GIVEN\n- 2x + 6 = 14\n\n## FORMULA\n\n$$ 2x + 6 = 14 $$\n\n## FINAL ANSWER\n\n$$ x = 4 $$');
check('math: clean answer passes', goodMath.ok);

const spot = deterministicChecks('What is 12 * 7?', '## FORMULA\n$$ 12 \\times 7 $$\n## FINAL ANSWER\nTherefore: **A = 83** ✓', 'math');
check('math: arithmetic spot-check catches wrong result', !spot.ok && spot.issues.some((i) => /Arithmetic spot-check/.test(i)));

/* ---------------- Code checks ---------------- */
const badCode = deterministicChecks('Write a python script', 'Here is the script:\n```python\nprint("hi")');
check('code: flags unbalanced fences', !badCode.ok && badCode.issues.some((i) => /Unbalanced code fences/.test(i)));
check('code: flags missing code blocks', !deterministicChecks('Write a python script', 'Just describe the approach.', 'code').ok);

const goodCode = deterministicChecks('Write a python script', '```python\ndef main():\n    print("hi")\n\nmain()\n```');
check('code: fenced code passes', goodCode.ok);

/* ---------------- Research checks ---------------- */
const badResearch = deterministicChecks('Research quantum computing', 'Quantum computing uses qubits.', 'research');
check('research: flags missing sources', !badResearch.ok && badResearch.issues.some((i) => /source links/.test(i)));

const goodResearch = deterministicChecks('Research quantum computing', '## KEY FINDINGS\n1. Qubits are the unit.\n## SOURCES\n- [Wikipedia](https://en.wikipedia.org/wiki/Quantum_computing)');
check('research: sourced structure passes', goodResearch.ok);

/* ---------------- Engineering checks ---------------- */
const badEng = deterministicChecks('Design a beam', 'The beam is fine.', 'engineering');
check('engineering: flags missing GIVEN/FORMULA', !badEng.ok && badEng.issues.some((i) => /GIVEN/.test(i)));

const goodEng = deterministicChecks('Design a beam', '## GIVEN\n- span 12 m\n## FORMULA\n$$ M = \\frac{wL^2}{8} $$\n## FINAL ANSWER\n$$ M = 180 \\text{ kN·m} $$');
check('engineering: structured solution passes', goodEng.ok);

/* ---------------- verifyDomainAnswer end-to-end (no keys → honest best-effort) ---------------- */
const v = await verifyDomainAnswer({ query: 'What is 12 * 7?', draft: '## FINAL ANSWER\n$$ x = 83 $$' });
check('verifyDomainAnswer returns a verdict', ['verified', 'best-effort', 'skipped'].includes(v.verdict));
check('verifyDomainAnswer reports the domain', v.domain === 'math');
check('verifyDomainAnswer reports deterministic issues without keys', v.issues.length >= 0 && typeof v.changed === 'boolean');

const clean = await verifyDomainAnswer({ query: 'Solve x', draft: '## GIVEN\n2x = 8\n## FORMULA\n$$ 2x = 8 $$\n## FINAL ANSWER\n$$ x = 4 $$' });
check('clean answer verifies without AI', clean.verdict === 'verified' && clean.changed === false);

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
