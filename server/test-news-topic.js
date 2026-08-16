/**
 * JEXI OS — news topic-fidelity regression suite (B83).
 * "Research on news about AI" must return AI stories, not generic world news.
 */

import { filterNews } from './src/services/NewsAgent.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

const mk = (title, source = 'bbc.com', date = '2026-08-16T10:00:00Z') => ({ title, link: `https://${source.replace('.', '-')}.example.com/story-${Math.random().toString(36).slice(2, 7)}`, snippet: `${title} — details.`, date, source });

console.log('\n== Topic-first ranking (query: "Research on news about AI") ==');
const fixture = [
  mk('Earthquake kills dozens in Indonesia as rescue continues'),
  mk('Hurricane lashes Hawaii leaving homes destroyed'),
  mk('New AI model beats humans at protein folding'),
  mk('OpenAI announces next-generation reasoning system'),
  mk('Russia and Ukraine exchange fire in border region'),
  mk('Central bank raises interest rates amid inflation fears'),
  mk('AI chip startup raises $500M to challenge Nvidia'),
  mk('Election results declared in local council races'),
  mk('Researchers use machine learning to predict heart disease'),
];
const out = filterNews(fixture, 'Research on news about AI');
ok(out.length > 0, 'returns stories');
const aiTitles = ['AI model', 'OpenAI', 'AI chip', 'machine learning'];
const firstFour = out.slice(0, 4).map((n) => n.title);
ok(firstFour.some((t) => aiTitles.some((a) => t.includes(a))), 'top stories are on-topic (AI)');
// Exactly 3 fixture stories are genuinely AI — all of them must be the top 3.
ok(out.slice(0, 3).every((n) => n.onTopic === true), 'all AI stories rank in the top 3');
const allAi = out.filter((n) => aiTitles.some((a) => n.title.includes(a)));
ok(allAi.length >= 3, 'most AI stories survive into the top list');
ok(out.findIndex((n) => n.title.includes('Earthquake')) > out.findIndex((n) => n.title.includes('OpenAI')), 'generic story ranks BELOW an AI story');

console.log('\n== Short topic tokens (2-letter like "AI") are matched ==');
const out2 = filterNews([mk('AI safety summit scheduled for Geneva'), mk('Markets rally on strong earnings')], 'news about AI');
ok(out2[0].onTopic === true && /AI/.test(out2[0].title), '"AI" alone (2 chars) drives relevance');

console.log('\n== No topic in query → generic ranking intact ==');
const out3 = filterNews([mk('Earthquake in Japan'), mk('New film breaks box office records')], 'latest headlines');
ok(out3.length === 2, 'all stories returned');

console.log('\n== Empty result safe ==');
ok(filterNews([], 'anything').length === 0, 'empty input → empty output');

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
