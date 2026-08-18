# FIXLOG-B124 — Plugins were still searching: root cause + fix

**Phase:** B124 · **Branch:** main

## Why plugins were still searching
1. **Classification sent plugin queries to research.** In `Planner.js`, `needsExternal`
   (weather|price|current time|…) EXCLUDED the direct-answer path, and "weather in
   Nairobi" / "price of bitcoin" / "convert 100 usd to ksh" matched NO research cue —
   so they fell to the default `learning_research` → the web-search pipeline.
2. **The AUTO direct path had no tools.** Even when a query routed "directly", the
   model got bare text generation — it could not call weather-now/crypto-price etc.
   (and web-search was the only "fact" tool reachable anywhere).

## The fix
1. **Plugin fast-path in the classifier** (`Planner.detectPluginIntent`, run BEFORE the
   LLM in `_classify` — deterministic, zero AI cost):
   - weather/forecast/temperature/rain → `weather` [weather-now]
   - bitcoin/btc/eth/sol/crypto/coin price → `crypto_price` [crypto-price]
   - convert/exchange rate + currency pairs (usd→ksh, dollars to shillings…) →
     `currency_convert` [currency-convert]
   - what time/current time/time in <place>/timezone → `time_now` [time-now]
   - my ip/ip address/ip location → `ip_geo` [ip-geo]
   These intents joined `DIRECT_INTENTS` (isDirectIntent = true), so AUTO routes them
   directly. Lookalikes stay safe: "price of eggs", "capital of kenya", "hello" are
   NOT misrouted.
2. **The AUTO direct path is now tool-capable**: it runs `generateWithToolsLoop` with
   ONLY the plugin tools (`buildNativeSchemas(listPluginTools())`) — **web-search is
   deliberately absent from that set**, so plugin queries literally cannot search. If
   the tool loop fails, it falls back to plain text generation. Explicit `normal`
   mode keeps bare text.
3. Log line now names the plugin: "⚡ Auto mode — answering with the weather-now
   plugin, no search needed."

## Verified
- `planner.analyzeIntent` live: all 5 plugin queries → correct plugin intent + tool;
  "capital of kenya" → direct_answer; "hello" → conversation.
- Boot test: "what is the weather in Nairobi" → auto-direct event, zero errors, zero
  search events, plugins loaded (5).
- test-auto-mode 61/61 (9 plugin queries routed + tool names, lookalikes rejected,
  direct path offers plugin tools and NO web-search); test-planner-routing green;
  full 54-suite sweep exit 0; lint 0.
- Deployed to Render via hook; /api/health verified.
