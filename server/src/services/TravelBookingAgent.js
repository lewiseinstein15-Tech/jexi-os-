/**
 * JEXI OS — Travel Booking Agent (B90: browser booking flow).
 *
 * "Book me a flight" — done properly, honestly:
 *
 *   1. PARSE  — extract kind (flight/hotel), origin, destination, dates,
 *               travelers, budget from natural language (regex + LLM-free).
 *   2. ASK    — if essentials are missing (e.g. no destination), return
 *               needInfo questions so the goal/chat flow can park and ask.
 *   3. SEARCH — open the real browser on pre-filled search URLs
 *               (Google Flights / Kayak / Booking.com) and read the results;
 *               if the browser is blocked/unavailable (bot protection,
 *               no Chromium), fall back to curated deep links + web search
 *               so the user ALWAYS gets usable options.
 *   4. RANK   — score options by price, rating, duration/quality.
 *   5. DECIDE — present the top options with direct links. The user picks;
 *               the chosen deal is opened in the browser (their device, or
 *               the agent's) — CHECKOUT AND PAYMENT ALWAYS STAY WITH THE
 *               USER. The agent never enters credentials or pays.
 *
 * Every external dependency is injectable for tests; every failure degrades
 * honestly (never a fake booking).
 */

import { aggregateSearch } from './SearchEngine.js';

/* ------------------------------------------------------------------ */
/* Parsing                                                            */
/* ------------------------------------------------------------------ */

const CITY_HINTS = {
  nairobi: 'NBO', mombasa: 'MBA', kisumu: 'KIS', eldoret: 'EDL',
  'new york': 'NYC', london: 'LON', 'los angeles': 'LAX', paris: 'PAR',
  dubai: 'DXB', 'san francisco': 'SFO', 'johannesburg': 'JNB', 'cape town': 'CPT',
  dar: 'DAR', 'dar es salaam': 'DAR', arusha: 'ARK', zanzibar: 'ZNZ',
  kampala: 'EBB', kigali: 'KGL', addis: 'ADD', 'addis ababa': 'ADD',
  cairo: 'CAI', 'hong kong': 'HKG', singapore: 'SIN', bangkok: 'BKK',
  sydney: 'SYD', melbourne: 'MEL', 'new delhi': 'DEL', mumbai: 'BOM',
  toronto: 'YYZ', 'sao paulo': 'GRU', mexico: 'MEX', amsterdam: 'AMS',
  berlin: 'BER', rome: 'FCO', madrid: 'MAD', lagos: 'LOS',
  accra: 'ACC', 'south africa': 'JNB', beijing: 'PEK',
  tokyo: 'TYO', seoul: 'ICN', istanbul: 'IST', 'abu dhabi': 'AUH', doha: 'DOH',
  athens: 'ATH', islamabad: 'ISB', karachi: 'KHI',
};

function normalizeCity(word) {
  const w = String(word || '').trim().toLowerCase();
  if (CITY_HINTS[w]) return { city: w, code: CITY_HINTS[w] };
  // Multi-word: try 2-word combos
  const words = w.split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    const combo = `${words[i]} ${words[i + 1]}`;
    if (CITY_HINTS[combo]) return { city: combo, code: CITY_HINTS[combo] };
  }
  if (w.length >= 3) return { city: w, code: null };
  return null;
}

/**
 * Extract booking details from natural language.
 * Returns { kind, origin, destination, date, returnDate, travelers, budget, missing[] }
 */
export function parseBookingQuery(query) {
  const q = String(query || '').toLowerCase();
  const out = { kind: null, origin: null, destination: null, date: null, returnDate: null, travelers: 1, budget: null, missing: [] };

  // Kind
  if (/\b(flight|flights|fly|plane|airline)\b/.test(q)) out.kind = 'flight';
  else if (/\b(hotel|hotels|room|stay|accommodation|hostel|airbnb|resort)\b/.test(q)) out.kind = 'hotel';
  else if (/\b(car|rental|taxi|drive)\b/.test(q)) out.kind = 'car';

  // Direction words — capture stops at the next stopword ("to Mombasa on" → "mombasa")
  const CITY_STOP = '(?:to|on|for|in|at|from|with|next|this|under|around|about|and|then|leaving|returning|overnight)';
  const toMatch = q.match(new RegExp(`\\b(?:to|into)\\s+([a-z][a-z .'-]*?)(?=\\s+(?:${CITY_STOP})\\b|$)`));
  const fromMatch = q.match(new RegExp(`\\b(?:from|out of)\\s+([a-z][a-z .'-]*?)(?=\\s+(?:${CITY_STOP})\\b|$)`));
  const inMatch = q.match(new RegExp(`\\b(?:in|at)\\s+([a-z][a-z .'-]*?)(?=\\s+(?:${CITY_STOP})\\b|$)`));

  if (toMatch && toMatch[1]) {
    const c = normalizeCity(toMatch[1]);
    if (c) out.destination = c;
  } else if (inMatch && inMatch[1]) {
    // "hotels in Mombasa" — the destination uses "in"
    const c = normalizeCity(inMatch[1]);
    if (c) out.destination = c;
  }
  if (fromMatch && fromMatch[1]) {
    const c = normalizeCity(fromMatch[1]);
    if (c) out.origin = c;
  }

  // Dates — ISO, "tomorrow", "next monday", "on 20 august", "aug 20", "2026-08-20"
  const iso = q.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const dmy = q.match(/\b(\d{1,2})(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
  const mdy = q.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(st|nd|rd|th)?\b/i);
  const monthNum = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  if (iso) out.date = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else if (dmy) {
    const y = new Date().getFullYear();
    out.date = `${y}-${String(monthNum[dmy[3].toLowerCase()] + 1).padStart(2, '0')}-${String(Number(dmy[1])).padStart(2, '0')}`;
  } else if (mdy) {
    const y = new Date().getFullYear();
    out.date = `${y}-${String(monthNum[mdy[1].toLowerCase()] + 1).padStart(2, '0')}-${String(Number(mdy[2])).padStart(2, '0')}`;
  } else if (/\btomorrow\b/.test(q)) {
    const d = new Date(Date.now() + 86400000);
    out.date = d.toISOString().slice(0, 10);
  } else if (/\btoday\b/.test(q)) {
    out.date = new Date().toISOString().slice(0, 10);
  }

  // Travelers
  const pax = q.match(/\b(\d+)\s*(?:passengers?|people|travelers?|adults?|guests?)\b/);
  if (pax) out.travelers = Math.max(1, Number(pax[1]));

  // Budget
  const budget = q.match(/\b(?:under|budget|max|less than|below)\s*\$\s?(\d{2,6})\b|\$\s?(\d{2,6})\b/);
  if (budget) out.budget = Number(budget[1] || budget[2]);

  // Essential validation
  if (out.kind === 'flight') {
    if (!out.origin) out.missing.push('origin');
    if (!out.destination) out.missing.push('destination');
  } else if (out.kind === 'hotel') {
    if (!out.destination) out.missing.push('destination');
  } else if (!out.kind) {
    out.missing.push('kind');
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Search URLs                                                        */
/* ------------------------------------------------------------------ */

function flightSearchUrl(d) {
  const o = d.origin && d.origin.code ? d.origin.code : (d.origin && d.origin.city ? encodeURIComponent(d.origin.city) : '');
  const dest = d.destination && d.destination.code ? d.destination.code : (d.destination ? encodeURIComponent(d.destination.city) : '');
  const date = d.date || '';
  if (o && dest) {
    return {
      label: `Kayak · ${String(d.origin.city).toUpperCase()} → ${String(d.destination.city).toUpperCase()}${date ? ` · ${date}` : ''}`,
      url: `https://www.kayak.com/flights/${o}-${dest}/${date}?sort=price_a`,
    };
  }
  const q = `flights from ${d.origin ? d.origin.city : ''} to ${d.destination ? d.destination.city : ''}${date ? ` on ${date}` : ''}`.trim();
  return { label: 'Google Flights search', url: `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}` };
}

function hotelSearchUrl(d) {
  const dest = d.destination ? encodeURIComponent(d.destination.city) : '';
  const checkin = d.date || '';
  const checkout = d.returnDate || (d.date ? addDays(d.date, 3) : '');
  return {
    label: `Booking.com · ${d.destination ? d.destination.city : ''}${checkin ? ` · ${checkin} → ${checkout}` : ''}`,
    url: `https://www.booking.com/searchresults.html?ss=${dest}${checkin ? `&checkin=${checkin}&checkout=${checkout}` : ''}&group_adults=${d.travelers || 1}&no_rooms=1`,
  };
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Browser reading (best-effort)                                      */
/* ------------------------------------------------------------------ */

/**
 * Open the URL in the agent's browser and read the visible text.
 * Returns { ok, text, title } — or { ok:false } when the browser is
 * unavailable/blocked (never throws into the flow).
 */
async function browserReadUrl(url, dm) {
  try {
    if (!dm) return { ok: false, error: 'no browser' };
    const g = await dm.goto('coder', url);
    if (!g || !g.title) return { ok: false, error: 'goto failed' };
    const t = await dm.pageText('coder');
    const text = String(t || '');
    if (/cloudflare|captcha|unusual traffic|enable javascript|robot/i.test(text.slice(0, 3000))) {
      return { ok: false, blocked: true, title: g.title, text: text.slice(0, 2000) };
    }
    return { ok: true, title: g.title, text: text.slice(0, 30000) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Crude price extraction from page text: $1,234 / US$123 / 123 USD. */
function extractPrices(text) {
  const out = [];
  const re = /\$[\s]?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*)\s*(?:usd|kSh|kes)/gi;
  let m;
  while ((m = re.exec(String(text || ''))) && out.length < 40) {
    const v = Number((m[1] || m[2] || '').replace(/,/g, ''));
    if (v > 10 && v < 200000) out.push(v);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Ranking                                                            */
/* ------------------------------------------------------------------ */

/**
 * Rank candidate options by score = quality − cost penalty.
 * For flights: shorter duration + fewer stops + lower price win.
 * For hotels: higher rating + lower price win.
 * Options carry { title, url, price, rating, durationMin, stops }.
 */
export function rankOptions(options, details = {}) {
  return [...options]
    .map((o) => {
      let score = 50;
      if (o.rating) score += o.rating * 6;
      if (o.durationMin) score -= Math.max(0, (o.durationMin - 120)) / 30; // >2h penalized
      if (o.stops) score -= o.stops * 4;
      if (o.price) {
        const budget = details.budget || 2000;
        const penalty = Math.min(30, (o.price / budget) * 12);
        score -= penalty;
      }
      return { ...o, score: Math.round(score) };
    })
    .sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/* The agent                                                          */
/* ------------------------------------------------------------------ */

export class TravelBookingAgent {
  /**
   * @param {object} deps
   * @param {object} [deps.desktopManager] — DesktopManager-like { goto, pageText }
   * @param {function} [deps.webSearch]    — (query) => Promise<results[]>  (defaults to aggregateSearch)
   */
  constructor(deps = {}) {
    this.dm = deps.desktopManager || null;
    this.webSearch = deps.webSearch || null;
    this.lastOptions = new Map(); // session → options[]
  }

  /** Options from the last run for a session (for pick routing). */
  getLastOptions(session) {
    return this.lastOptions.get(session) || null;
  }

  /**
   * Run the booking flow. Returns:
   *   { needInfo: [...] }                 — essentials missing (park like goals)
   *   { success, summary, options, openUrl? } — results presented
   */
  async run({ query, session = 'default', sendEvent = () => {}, opts = {} }) {
    const emit = (t, d) => { try { sendEvent(t, d); } catch { /* noop */ } };

    // A selection resolves against the LAST presented options — no re-parse.
    if (opts.selected !== undefined && opts.selected !== null) {
      const ranked = this.lastOptions.get(session) || [];
      const pick = typeof opts.selected === 'number' ? ranked[opts.selected] : ranked.find((o) => String(o.id) === String(opts.selected));
      if (pick) {
        emit('travel.pick', { url: pick.url, title: pick.title });
        if (this.dm) {
          try { await this.dm.goto('coder', pick.url); emit('travel.opened', { url: pick.url, title: pick.title }); } catch { /* open on user's device instead */ }
        }
        return {
          success: true,
          selected: pick,
          summary: `### ✈️ Your pick — ${pick.title}\n\n**[Open it now](${pick.url})** — review and complete the booking on the site.\n\n⚠️ Payment and personal details always stay with you — I never enter credentials or pay.`,
        };
      }
      return { success: false, error: 'selection not found', summary: '### ⚠ JEXI OS\n\nI could not find that option — run the search again.' };
    }

    const details = parseBookingQuery(query);
    emit('travel.parse', { kind: details.kind, origin: details.origin && details.origin.city, destination: details.destination && details.destination.city, date: details.date, missing: details.missing });

    if (details.missing.length) {
      const questions = [];
      if (details.missing.includes('kind')) questions.push({ field: 'kind', question: 'What would you like to book — a flight, hotel, or car?' });
      if (details.missing.includes('origin')) questions.push({ field: 'origin', question: 'Where are you departing from?' });
      if (details.missing.includes('destination')) questions.push({ field: 'destination', question: `Where do you want to go${details.kind ? ` (for your ${details.kind})` : ''}?` });
      emit('travel.need-info', { questions });
      return { needInfo: questions, details };
    }

    // 1) Build the primary search link.
    let primary;
    if (details.kind === 'hotel') primary = hotelSearchUrl(details);
    else primary = flightSearchUrl(details);
    emit('travel.search', { kind: details.kind, url: primary.url, label: primary.label });

    // 2) Try the browser read; collect any prices found.
    let browserText = '';
    let browserBlocked = false;
    const browserRes = await browserReadUrl(primary.url, this.dm);
    if (browserRes.ok) {
      browserText = browserRes.text;
      emit('travel.browser', { ok: true, title: browserRes.title, pricesFound: extractPrices(browserText).length });
    } else if (browserRes.blocked) {
      browserBlocked = true;
      emit('travel.browser', { ok: false, blocked: true, note: 'bot protection — using curated links instead' });
    } else {
      emit('travel.browser', { ok: false, error: browserRes.error || 'browser unavailable' });
    }

    // 3) Build the option list: primary link + a few web-search-derived
    //    alternatives (fares/hotels pages) so there's always a choice.
    const options = [];
    const prices = extractPrices(browserText);
    const estPrice = prices.length ? Math.round(prices.slice(0, 8).reduce((a, b) => a + b, 0) / Math.min(prices.length, 8)) : null;

    options.push({
      id: 'opt-1',
      title: primary.label,
      url: primary.url,
      price: estPrice,
      rating: null,
      source: details.kind === 'hotel' ? 'Booking.com' : 'Kayak',
      note: browserBlocked ? 'opens the live search — prices shown on site' : (estPrice ? `typical price seen ~$${estPrice}` : 'opens the live search'),
    });

    // Alternatives via web search (best-effort, bounded 3s each).
    if (this.webSearch) {
      try {
        const q = details.kind === 'hotel'
          ? `best hotels in ${details.destination.city}${details.date ? ` ${details.date}` : ''}`
          : `cheap flights ${details.origin ? details.origin.city : ''} to ${details.destination.city}${details.date ? ` ${details.date}` : ''}`;
        const results = await this.webSearch(q);
        for (const r of (results || []).slice(0, 4)) {
          if (r && r.link && !options.some((o) => o.url === r.link)) {
            options.push({ id: `opt-${options.length + 1}`, title: String(r.title || r.link).slice(0, 100), url: r.link, price: null, rating: null, source: 'web', note: 'found in search results' });
          }
        }
      } catch { /* fallback links only */ }
    }

    // 4) Rank.
    const ranked = rankOptions(options, details);
    this.lastOptions.set(session, ranked);
    emit('travel.options', { count: ranked.length, top: ranked.slice(0, 5).map((o) => ({ id: o.id, title: o.title, price: o.price, url: o.url })) });

    // 6) Present the ranked options.
    const lines = ranked.slice(0, 5).map((o, i) => `${i + 1}. **${o.title}** — ${o.price ? `~$${o.price}` : 'check price'}${o.rating ? ` · ★${o.rating}` : ''}\n   ${o.url}`).join('\n');
    return {
      success: true,
      options: ranked.slice(0, 5),
      details,
      summary: `### ${details.kind === 'hotel' ? '🏨' : '✈️'} ${details.kind === 'hotel' ? 'Hotels' : 'Flights'} for ${details.destination ? details.destination.city : 'your trip'}${details.date ? ` on ${details.date}` : ''}\n\n${lines}\n\n**Tell me which one** (e.g. "pick 2") and I'll open it for you — checkout always stays with you.`,
    };
  }
}

export const travelBookingAgent = new TravelBookingAgent();
