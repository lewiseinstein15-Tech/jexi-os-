# FIXLOG-B90.md — Browser Booking Flow (flights, hotels, cars)

Build 90 (Aug 16, 2026) — "book me a flight", done properly and honestly.

## What was added

- **TravelBookingAgent (`server/src/services/TravelBookingAgent.js`)**:
  - PARSE — extracts kind (flight/hotel/car), origin, destination (with
    airport codes for 40+ cities), ISO/DMY dates, travelers, budget from
    natural language. Missing essentials → structured needInfo questions.
  - SEARCH — opens the real browser (Playwright/DesktopManager) on
    pre-filled live search URLs (Kayak/Google Flights, Booking.com) and
    reads the results, extracting prices from the page text.
  - FALLBACK — if the browser is unavailable or blocked (Cloudflare/captcha
    — common on booking sites), it always degrades to curated live-search
    links + web-search alternatives, so the user never leaves empty-handed.
  - RANK — options scored by price, rating, duration/stops; top 5 presented
    with direct links.
  - DECIDE — "pick 2" opens the chosen deal in the browser. CHECKOUT AND
    PAYMENT ALWAYS STAY WITH THE USER — the agent never enters credentials
    or pays (stated in every summary).
- **Endpoints + chat**: `POST /api/travel/search` (NDJSON stream with
  travel.parse/search/browser/options events) and chat commands `/book`,
  `/flights`, `/hotels`; "pick N" routes to the last presented options.
- Event vocabulary: travel.parse · travel.search · travel.browser ·
  travel.options · travel.pick/travel.opened · travel.need-info · done.

## Verification

- New suite `test-travel.js` — **32 assertions** (all browser/search mocked):
  parsing (codes, dates, travelers, budget, missing), ranking order,
  no-browser fallback → curated + web links, browser works → prices
  extracted, bot-protection blocked → graceful, pick flow opens the deal +
  honest payment boundary, needInfo for incomplete queries.
- 23-suite sweep green on Node 22 · lint 0 · live e2e: parse → search →
  browser attempt → ranked options with the live Kayak link (NBO→MBA,
  price-sorted) → done.
