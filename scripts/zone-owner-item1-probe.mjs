#!/usr/bin/env node
/**
 * ZONE-OWNER ITEM 1 LIVE PROBE — readSkillMeta camelCase fix
 * Run from repo root:  node scripts/zone-owner-item1-probe.mjs
 * Proves: camelCase frontmatter keys (whenToUse, allowedTools) now parse;
 *         pre-fix regex demonstrably dropped them; diagram-design SKILL.md
 *         loads BOTH ways (lowercase workaround AND camelCase).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSkillMeta } from '../server/src/services/SkillLoop.js';

let fails = 0; let checks = 0;
const check = (label, cond, detail = '') => {
  checks++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails++;
};

// ---- 1. temp skill with camelCase frontmatter, loaded through the REAL function
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmeta-'));
const skillFile = path.join(dir, 'SKILL.md');
fs.writeFileSync(skillFile, [
  '---',
  'name: probe-skill',
  'description: probe fixture (temp file, not a repo skill)',
  'whenToUse: use when probing frontmatter parsing',
  'allowedTools: [code-write, code-run]',
  '---',
  '',
  'Probe body.',
  '',
].join('\n'));

const meta = readSkillMeta(skillFile);
console.log('parsed keys:', Object.keys(meta).filter((k) => k !== 'body').join(', '));
check('whenToUse parses (post-fix)', meta.whenToUse === 'use when probing frontmatter parsing');
check('allowedTools parses (post-fix)', meta.allowedTools === '[code-write, code-run]');
check('lowercase keys still parse (no regression)', meta.name === 'probe-skill' && meta.description.includes('probe fixture'));

// ---- 2. demonstrate PRE-FIX behavior on the same bytes (old regex simulated)
const raw = fs.readFileSync(skillFile, 'utf-8');
const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)[1];
const oldMeta = {};
for (const line of fm.split('\n')) {
  const kv = line.match(/^([a-z_]+):\s*(.*)$/); // ← pre-fix regex, verbatim
  if (kv) oldMeta[kv[1]] = kv[2];
}
console.log('pre-fix parsed keys:', Object.keys(oldMeta).join(', '));
check('pre-fix regex DROPPED whenToUse (bug reproduced)', oldMeta.whenToUse === undefined);
check('pre-fix regex DROPPED allowedTools (bug reproduced)', oldMeta.allowedTools === undefined);

// ---- 3. real diagram-design SKILL.md loads BOTH ways
const dd = readSkillMeta('skills/design/diagram-design/SKILL.md');
check('diagram-design lowercase workaround still loads (whentouse)', typeof dd.whentouse === 'string' && dd.whentouse.startsWith('Use when explaining'));
check('diagram-design lowercase workaround still loads (allowedtools)', dd.allowedtools === '[code-write, code-run]');
// camelCase the same file's frontmatter in a temp copy → must now parse
const ddRaw = fs.readFileSync('skills/design/diagram-design/SKILL.md', 'utf-8');
const ddCamel = ddRaw.replace('whentouse:', 'whenToUse:').replace('allowedtools:', 'allowedTools:');
const ddCamelFile = path.join(dir, 'SKILL-camel.md');
fs.writeFileSync(ddCamelFile, ddCamel);
const dd2 = readSkillMeta(ddCamelFile);
check('diagram-design camelCase variant NOW loads (whenToUse)', typeof dd2.whenToUse === 'string' && dd2.whenToUse.startsWith('Use when explaining'));
check('diagram-design camelCase variant NOW loads (allowedTools)', dd2.allowedTools === '[code-write, code-run]');

// ---- 4. affected population: SKILL.md files with camelCase frontmatter keys
let scanned = 0; let affected = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'SKILL.md') { scanned++; const r = fs.readFileSync(p, 'utf-8'); const m = r.match(/^---\n([\s\S]*?)\n---/); if (m && /^([a-zA-Z]+[A-Z][a-zA-Z]*):/m.test(m[1])) affected++; } } };
walk('skills');
console.log(`repo scan: ${affected} of ${scanned} SKILL.md files carry camelCase frontmatter keys`);
check('affected population is non-trivial', affected > 0, `${affected}/${scanned}`);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n===== PROBE TALLY: ${checks} checked, ${checks - fails} pass, ${fails} fail =====`);
process.exit(fails === 0 ? 0 : 1);
