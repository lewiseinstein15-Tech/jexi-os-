/**
 * B93 — research source diversity: answers must come from MANY sources,
 * never one site (Wikipedia alone).
 */
import { rankSources } from './src/services/SearchAgent.js';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failed++; console.log(`  ❌ ${n}`); } };

const mk = (title, host, i) => ({ title, link: `https://${host}/page-${i}`, snippet: title });

console.log('\n== Diversity: max 2 per domain, up to 10 total ==');
const results = [];
for (let i = 0; i < 8; i++) results.push(mk(`Wikipedia article about solar ${i}`, 'en.wikipedia.org', i));
for (let i = 0; i < 4; i++) results.push(mk(`Solar energy report ${i}`, 'iea.org', i));
for (let i = 0; i < 4; i++) results.push(mk(`Solar panel guide ${i}`, 'solarreviews.com', i));
for (let i = 0; i < 3; i++) results.push(mk(`Sun power research ${i}`, 'nrel.gov', i));
for (let i = 0; i < 3; i++) results.push(mk(`Photovoltaic news ${i}`, 'pv-magazine.com', i));
const ranked = rankSources('how do solar panels work', results);
ok(ranked.length <= 10, `≤10 sources (got ${ranked.length})`);
const counts = {};
for (const r of ranked) {
  const h = new URL(r.link).hostname;
  counts[h] = (counts[h] || 0) + 1;
}
const hosts = Object.keys(counts).length;
ok(hosts >= 4, `multiple distinct domains used (got ${hosts}: ${Object.keys(counts).join(', ')})`);
ok(Object.values(counts).every((c) => c <= 2), 'no domain exceeds 2 sources');
ok(counts['en.wikipedia.org'] <= 2, 'Wikipedia capped (never alone)');

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
