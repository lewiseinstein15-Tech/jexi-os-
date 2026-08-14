// B50 P1 — PROGRESSIVE-DISCLOSURE SKILLS.
// Proves: folders are preferred over flat files; planning-time metadata
// (name + description) never leaks the full body; the full SKILL.md +
// reference.md body loads only at execution time (loadSkill).
import fs from 'fs';
import path from 'path';
import { loadSkill, skillMeta, skillFolder, planningSkillSummaries } from './src/services/SkillChain.js';

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}`);
};

// The seven skills that MUST be progressive folders per the directive.
const FOLDERS = ['product', 'engineer', 'coder', 'qa', 'reviewer', 'security-officer', 'reflector'];

// 1. Every required skill is a real folder with SKILL.md (+ reference.md present).
for (const s of FOLDERS) {
  check(`folder exists for ${s}`, !!skillFolder(s));
}
for (const s of FOLDERS) {
  const dir = skillFolder(s);
  const hasRef = !!dir && fs.existsSync(path.join(dir, 'reference.md'));
  check(`reference.md present for ${s}`, !!dir && hasRef);
}

// 2. Planning-time metadata: name + description present, full body absent.
for (const s of FOLDERS) {
  const meta = skillMeta(s);
  check(`planning meta for ${s} has name+description`, !!meta.name && meta.description.length > 10);
  // The meta object must NOT carry the full body (progressive disclosure).
  check(`planning meta for ${s} does NOT expose full body`, JSON.stringify(meta).length < 500);
}
// Reference-only phrases must never appear in the planning summary.
const planningJson = JSON.stringify(planningSkillSummaries());
check('planning list has all 7 skills', FOLDERS.every((s) => planningJson.includes(`"slug":"${s}"`) || planningJson.includes(`"slug": "${s}"`)));
for (const leak of ['OWASP', 'acceptance criteria are machine-testable', 'MAX 6', 'Rubric']) {
  check(`planning context does NOT leak reference body (${leak})`, !planningJson.includes(leak));
}

// 3. Execution time: loadSkill returns the FULL body (SKILL.md + reference.md),
//    and each body is substantially larger than its planning metadata.
for (const s of FOLDERS) {
  const sk = loadSkill(s);
  const meta = skillMeta(s);
  check(`loadSkill(${s}) is progressive (folder path)`, !!sk && sk.progressive === true);
  check(`loadSkill(${s}) body is large (${sk?.md.length} chars > meta)`, !!sk && sk.md.length > JSON.stringify(meta).length * 2);
}

// 4. Folder is preferred over the flat file: 'coder'/'qa'/'reflector' had NO
//    flat file and previously loaded via synthesis — now they load from disk.
for (const s of ['coder', 'qa', 'reflector']) {
  const sk = loadSkill(s);
  check(`loadSkill(${s}) no longer synthesized (progressive from disk)`, !!sk && sk.progressive === true && !sk.synthesized);
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
