# FIXLOG-B122 — Two new plugins: crypto-price + ip-geo (free, no key)

**Phase:** B122 · **Branch:** main

## What's new
Two more plugins mounted through the DeepSeek-Harness seam (now 5 runtime plugins +
the bundled coding-pipeline skills):

| Plugin | Tool | What it does | API |
|---|---|---|---|
| `crypto` | `crypto-price` | Live prices + 24h change for BTC, ETH, SOL, … (symbols or ids, comma-separated; any quote currency). 60s cache. | CoinGecko (free, no key) |
| `ipgeo` | `ip-geo` | Location, country/flag, region/city, coordinates, ISP/org/ASN and timezone+local time for any IP — omit the IP for your own. | ipwho.is (free, no key) |

- Both have canonical zod output contracts and honest failures (unknown coin,
  unreachable service).
- The model already gets every plugin tool in its offered set (AgentLoop + SIMPLE
  path merge `listPluginTools()`), so JEXI can call them from chat.
- Settings → LOADED PLUGINS now lists 5 plugin tools.

## Verification
- Boot: `[Plugins] ✓ Loaded 5 plugin(s): crypto, currency, ipgeo, timezone, weather`
- Live smoke through the gated runtime: crypto-price(btc,eth,sol) ok; ip-geo(8.8.8.8)
  ok (San Jose, US, Google ASN, local time); unknown coin → honest failure.
- test-plugins-all 25 → 29 (5 plugins mounted, each executes through the gate).
- Full 54-suite sweep exit 0; lint 0.
- Deployed to Render via the deploy hook; verified via /api/health build.commit.

## How to use
- "what's the price of bitcoin and ethereum" → `crypto-price` {coins: "btc,eth"}
- "how much is 5 SOL in KES" → crypto-price + currency-convert
- "where is this IP from" / "what's my IP location" → `ip-geo`
