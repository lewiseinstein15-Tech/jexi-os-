/**
 * JEXI OS — Travel Booking Agent regression suite (B90).
 * Parsing, ranking, browser fallback, pick flow — browser + search mocked.
 */

import { parseBookingQuery, rankOptions, TravelBookingAgent } from './src/services/TravelBookingAgent.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log('\n== Parsing ==');
{
  const f = parseBookingQuery('book me a flight from Nairobi to Mombasa on 2026-09-01');
  ok(f.kind === 'flight', 'kind flight');
  ok(f.origin && f.origin.city === 'nairobi' && f.origin.code === 'NBO', 'origin parsed with code');
  ok(f.destination && f.destination.city === 'mombasa' && f.destination.code === 'MBA', 'destination parsed with code');
  ok(f.date === '2026-09-01', 'ISO date parsed');
  ok(f.missing.length === 0, 'nothing missing');
}
{
  const h = parseBookingQuery('hotels in Mombasa next weekend for 2 people under $100');
  ok(h.kind === 'hotel', 'kind hotel');
  ok(h.destination && h.destination.city === 'mombasa', 'destination parsed');
  ok(h.travelers === 2, 'travelers parsed');
  ok(h.budget === 100, 'budget parsed');
  ok(h.missing.length === 0, 'hotel only needs destination');
}
{
  const m = parseBookingQuery('book a flight');
  ok(m.kind === 'flight' && m.missing.includes('origin') && m.missing.includes('destination'), 'missing origin+destination reported');
}
{
  const f2 = parseBookingQuery('flights from Nairobi to London on 20 aug');
  ok(f2.date === '2026-08-20', 'DMY date parsed');
}

console.log('\n== Ranking ==');
{
  const opts = [
    { title: 'A', url: 'a', price: 500, rating: 8, durationMin: 120, stops: 0 },
    { title: 'B', url: 'b', price: 150, rating: 5, durationMin: 300, stops: 2 },
    { title: 'C', url: 'c', price: 300, rating: 9, durationMin: 180, stops: 1 },
  ];
  const ranked = rankOptions(opts, { budget: 600 });
  ok(ranked.length === 3, 'all ranked');
  ok(ranked[0].score >= ranked[1].score && ranked[1].score >= ranked[2].score, 'sorted by score desc');
  ok(ranked.some((o) => o.score > 0), 'scores computed');
}

console.log('\n== Browser fallback (no browser → curated links + web search) ==');
{
  const agent = new TravelBookingAgent({
    desktopManager: null,
    webSearch: async () => [{ title: 'Cheap flights site', link: 'https://example.com/fares' }],
  });
  const events = [];
  const out = await agent.run({ query: 'book a flight from Nairobi to Mombasa on 2026-09-01', session: 't1', sendEvent: (t) => events.push(t) });
  ok(out.success === true, 'succeeds without a browser');
  ok(events.includes('travel.parse') && events.includes('travel.search'), 'parse + search events emitted');
  ok(out.options && out.options.length >= 2, 'returns primary + web alternatives');
  ok(out.options.some((o) => /kayak|google/i.test(o.url)), 'includes the live search link');
  ok(out.options.some((o) => /example\.com/.test(o.url)), 'includes web-search alternative');
  ok(/pick/i.test(out.summary), 'asks the user to pick');
  ok(agent.getLastOptions('t1').length >= 2, 'lastOptions stored for pick routing');
}

console.log('\n== Browser works → extracts prices ==');
{
  const dm = {
    async goto() { return { title: 'Kayak — flights' }; },
    async pageText() { return 'Cheap flight $245 from NBO to MBA. Also $312 option with one stop.'; },
  };
  const agent = new TravelBookingAgent({ desktopManager: dm, webSearch: null });
  const events = [];
  const out = await agent.run({ query: 'flights from Nairobi to Mombasa', session: 't2', sendEvent: (t) => events.push(t) });
  ok(out.success === true, 'succeeds with browser');
  ok(events.some((e) => e === 'travel.browser'), 'browser event emitted');
  ok(out.options[0].price >= 200, 'price extracted from page text (~245)');
}

console.log('\n== Browser blocked (bot protection) → graceful ==');
{
  const dm = {
    async goto() { return { title: 'Cloudflare' }; },
    async pageText() { return 'Enable JavaScript and cookies to continue. captcha'; },
  };
  const agent = new TravelBookingAgent({ desktopManager: dm, webSearch: null });
  const events = [];
  const out = await agent.run({ query: 'book a hotel in Mombasa', session: 't3', sendEvent: (t) => events.push(t) });
  ok(out.success === true, 'blocked → still presents the curated link');
  ok(events.some((e) => e === 'travel.browser'), 'browser event emitted');
  ok(/booking\.com/.test(out.options[0].url), 'primary Booking.com link present');
}

console.log('\n== Pick flow opens the selected option ==');
{
  const opened = [];
  const dm = {
    async goto(_a, url) { opened.push(url); return { title: 'opened' }; },
    async pageText() { return ''; },
  };
  const agent = new TravelBookingAgent({ desktopManager: dm, webSearch: null });
  await agent.run({ query: 'flights from Nairobi to Mombasa', session: 't4' });
  const out = await agent.run({ query: 'pick', session: 't4', opts: { selected: 0 } });
  ok(out.success === true && out.selected, 'pick returns the selected option');
  ok(opened.length >= 1, 'browser opened the selected deal');
  ok(/Payment and personal details always stay with you/.test(out.summary), 'honest payment boundary in the summary');
}

console.log('\n== needInfo when essentials missing ==');
{
  const agent = new TravelBookingAgent({ desktopManager: null, webSearch: null });
  const out = await agent.run({ query: 'book a flight', session: 't5' });
  ok(out.needInfo && out.needInfo.length >= 2, 'asks for origin + destination');
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
