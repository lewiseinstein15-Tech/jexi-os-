/**
 * JEXI OS — Phase 28 Scope C probe — zero-LLM typed-edge KG.
 * P1 precedence · P2 frontmatter edges · P3 zero-LLM/network proof ·
 * P4 watermark freshness · P5 determinism.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepo } from '../brain/repo/index.js';
import {
  extract, inferType, frontmatterEdges, stale, extractStale, validateEdge,
  VERB_PRECEDENCE, LINK_EXTRACTOR_VERSION_TS, readWatermark,
} from '../brain/kg/index.js';

let pass = 0, fail = 0;
const ok = (c, label, extra = '') => {
  if (c) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label + (extra ? ' — ' + extra : '')); }
};

// ── P1: precedence on one sentence ──
console.log('── P1 verb precedence ──');
console.log('P1 declared precedence:', VERB_PRECEDENCE.join(' > '));
const all = 'Ada founded Analytical Co, invested in Babbage Ltd, advises the Royal Board, and works at the Mill Office.';
console.log('P1 sentence:', all);
console.log('P1 inferType(all) ->', JSON.stringify(inferType(all)));
ok(inferType(all).verb === 'founded', 'P1 founded beats all');
const noFounded = 'Ada invested in Babbage Ltd, advises the Royal Board, and works at the Mill Office.';
ok(inferType(noFounded).verb === 'invested_in', 'P1 invested_in beats advises/works_at when founded absent');
const noInv = 'Ada advises the Royal Board and works at the Mill Office.';
ok(inferType(noInv).verb === 'advises', 'P1 advises beats works_at');
const onlyWorks = 'Ada works at the Mill Office.';
ok(inferType(onlyWorks).verb === 'works_at', 'P1 works_at when nothing higher');
ok(inferType('Ada met Babbage once.').verb === 'mentions', 'P1 mentions catch-all');

// full page extraction
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p28c-'));
const repo = createRepo(root);
const T0 = '2026-09-22T06:00:00Z';
repo.create('people', 'ada-lovelace', {
  title: 'Ada Lovelace',
  compiledTruth: 'Ada founded Analytical Co. She invested in Babbage Ltd.',
  tags: [], now: T0,
});
repo.append('people', 'ada-lovelace', { entry: 'She advises the Royal Board. Later she works at the Mill Office. Ada met Charles Babbage once.', when: '2026-09-22T06:01:00Z' });
const page = repo.read('people', 'ada-lovelace');
const { edges } = extract(page);
console.log('P1 edges from fixture page:');
for (const e of edges) console.log(`   ${e.from} -[${e.verb}]-> ${e.to}   evidence="${e.evidence}"`);
ok(edges.every((e) => e.from && e.to && e.verb && e.evidence), 'P1 every edge carries { from, to, verb, evidence }');
const s1 = edges.find((e) => e.evidence.startsWith('Ada founded'));
ok(s1 && s1.verb === 'founded' && s1.to === 'Analytical Co', 'P1 founded sentence -> founded edge');
const s4 = edges.find((e) => e.evidence.startsWith('Later she works'));
ok(s4 && s4.verb === 'works_at', 'P1 works_at sentence -> works_at edge');

// ── P2: frontmatter edges ──
console.log('── P2 frontmatter mapping ──');
const fm = {
  slug: 'analytical-co',
  founded: 'Ada Lovelace',
  investors: ['Babbage Capital', 'Menabrea Fund'],
  key_people: ['Ada Lovelace', 'Charles Babbage'],
  attendees: ['Charles Babbage'],
};
const fmEdges = frontmatterEdges(fm);
console.log('P2 frontmatter edges:');
for (const e of fmEdges) console.log(`   ${e.from} -[${e.verb}]-> ${e.to}   evidence="${e.evidence}"`);
const has = (f, t, v) => fmEdges.some((e) => e.from === f && e.to === t && e.verb === v);
ok(has('Ada Lovelace', 'analytical-co', 'founded'), 'P2 founded field -> founded edge');
ok(has('Babbage Capital', 'analytical-co', 'invested_in') && has('Menabrea Fund', 'analytical-co', 'invested_in'), 'P2 investors -> invested_in edges');
ok(has('Ada Lovelace', 'analytical-co', 'works_at') && has('Charles Babbage', 'analytical-co', 'works_at'), 'P2 key_people -> works_at edges');
ok(has('Charles Babbage', 'analytical-co', 'mentions'), 'P2 attendees -> mentions edges (declared v1 mapping)');

// ── P3: zero LLM / zero network ──
console.log('── P3 zero-LLM / zero-network proof ──');
const kgDir = path.resolve('brain/kg');
const files = fs.readdirSync(kgDir).filter((f) => f.endsWith('.js')).sort();
const banned = /(fetch\(|https?\.request|XMLHttpRequest|axios|net\.(connect|createConnection)|WebSocket|openai|anthropic|llm|embedding|backends\/provider|brain\/index)/i;
const allowedImport = /^(node:|\.\.\/\.\.\/semantica\/_internal\.js$|\.\/|\.\.\/repo\/index\.js$)/;
let bannedHits = []; let imports = [];
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')          // block comments (incl. JSDoc usage examples)
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n'); // line comments
for (const f of files) {
  const src = stripComments(fs.readFileSync(path.join(kgDir, f), 'utf8'));
  src.split('\n').forEach((line, i) => { if (banned.test(line)) bannedHits.push(`${f}: ${line.trim()}`); });
  for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) imports.push(`${f} -> ${m[1]}`);
}
console.log('P3 brain/kg files:', files.join(', '));
console.log('P3 import graph:'); imports.forEach((s) => console.log('   ' + s));
console.log('P3 banned-pattern hits:', bannedHits.length ? bannedHits : 'NONE');
ok(bannedHits.length === 0, 'P3 no fetch/http/LLM/provider/embedding call site or import in brain/kg/**');
ok(imports.every((s) => allowedImport.test(s.split(' -> ')[1])), 'P3 every import is node builtin, semantica, brain/kg sibling, or brain/repo public API');

// ── P4: watermark ──
console.log('── P4 watermark freshness ──');
console.log('P4 LINK_EXTRACTOR_VERSION_TS=' + LINK_EXTRACTOR_VERSION_TS);
const before = extractStale(root, { now: '2026-09-22T06:05:00Z' });
console.log('P4 first extractStale:', JSON.stringify(before));
ok(before.reextracted === 1 && before.skipped === 0, 'P4 first run re-extracts the stale page');
const wm1 = readWatermark(root, 'people', 'ada-lovelace');
console.log('P4 watermark after first run: links_extracted_at=' + wm1.links_extracted_at + ' version=' + wm1.link_extractor_version + ' edge_count=' + wm1.edge_count);
const again = extractStale(root, { now: '2026-09-22T06:05:00Z' });
ok(again.reextracted === 0 && again.skipped === 1, 'P4 second run: nothing stale, page skipped');
// page edit -> stale again
repo.append('people', 'ada-lovelace', { entry: 'She advises the Analytical Society.', when: '2026-09-22T06:10:00Z' });
ok(stale(repo.list(), { root }).length === 1, 'P4 page edit (updated_at > links_extracted_at) -> stale detected');
// version bump via declared seam
const bumped = stale(repo.list(), { root, version: '2026-09-23T00:00:00Z' });
ok(bumped.length === 1, 'P4 version bump -> stale detected');
const after = extractStale(root, { now: '2026-09-22T06:15:00Z' });
const wm2 = readWatermark(root, 'people', 'ada-lovelace');
console.log('P4 watermark after re-extract: links_extracted_at=' + wm2.links_extracted_at + ' edge_count=' + wm2.edge_count);
ok(after.reextracted === 1 && wm2.links_extracted_at === '2026-09-22T06:15:00Z' && wm2.edge_count > wm1.edge_count,
  'P4 extractStale re-extracted; watermark advanced; edge count grew with the page');

// ── P5: determinism ──
console.log('── P5 determinism ──');
const a = JSON.stringify(extract(page));
const b = JSON.stringify(extract(repo.read('people', 'ada-lovelace') && page));
ok(a === b, 'P5 same page twice -> byte-identical edges');
try { validateEdge({ from: 'a', to: 'B', verb: 'married_to', evidence: 'x' }); ok(false, 'P5/contract unknown verb rejected'); }
catch (e) { ok(e.code === 'E_UNKNOWN_EDGE_KIND', 'P5/contract unknown edge kind -> E_UNKNOWN_EDGE_KIND (' + e.code + ')'); }

console.log('');
console.log('SCOPE C: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
