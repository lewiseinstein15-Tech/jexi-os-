# FIXLOG B220 — retry-after-aware cooldowns: stop re-poking quota-blocked providers

**Date:** 2026-09-04 (night) · **Trigger:** measured during B219 verification

## What was happening

After B219 removed the dead-model waste, a timed prod question still showed the
cascade burning round-trips on quota-blocked providers:

- Gemini answers 429 with **"Please retry in 47.9s"** (free-tier RPM window)
- Groq answers 429 with **"Please try again in 2m13s"** (and, revealingly,
  `tokens per day: Limit 200000, Used 198933` — the org's DAILY budget was
  nearly drained, the real reason tonight's answers were slow)
- but the cooldown was a flat **30s after 3 consecutive failures** — so every
  ~30s she poked the quota-dead provider again, ate another 429, and only then
  slid to the (slower) free fallbacks. The user felt this as "taking a lot of
  time on understanding the question".

## Fixes

- **`ProviderRouter.recordProviderFailure(key, retryAfterMs)`** — when the
  provider SAID when to come back, park it for exactly that window (+3s slack,
  bounded [1s, 15min]) on the FIRST failure; never shortens an existing longer
  cooldown. Without a hint, the old 3-strike → 30s rule is unchanged.
- **`LLMClient`** — `__parseRetryAfterMs(msg)` (pure, exported, tested) parses
  Gemini's "retry in 46.8s", Groq/OpenRouter's "try again in 3.2s", minutes and
  ms variants; the try* catch blocks harvest hints into a freshness-bounded
  side channel (hints older than 60s are ignored — a stale hint can never
  over-cooldown), and all 4 cascade failure sites now consume it
  (`noteProviderFailure`).
- `providerOrder` already parks cooling providers at the tail — so a parked
  provider is still last-resort, just not probed-first.

## Tests (`test-b220.js`, 7 cases, in the npm chain)

- parser: Gemini/Groq message shapes, minutes, ms floor, 15-min cap, no-hint → null
- hinted 429 parks the provider IMMEDIATELY (no 3-strike wait) + tail position
- no-hint streak rule unchanged (2 fails = no cooldown, 3rd = 30s)
- success clears cooldown and restores head position
- a shorter hint never shortens a longer existing cooldown

## Also fixed en route

- **test-b217.js flake**: the "mutate one file → re-push" assertion depended on
  mtime actually changing; container filesystems have coarse mtime resolution
  and a same-tick rewrite looked unchanged (flaked once in a full-chain run —
  0 !== 1). Now bumps mtime explicitly with `fs.utimesSync` — deterministic,
  verified 5/5 consecutive standalone runs + full chain.

## Verification

- Full `npm test` chain (incl. b220): **PASS, exit 0, zero failures**
- Prod expectation: with Groq TPD ~exhausted, the next deploy should log ONE
  429 per provider then park them for the hinted window (no more 429 spam
  every 30s); answers route to the healthy tail providers without the
  dead-provider tax.

## Honest limits

- Free-tier quotas are physics: when Groq's DAILY token budget is spent (as
  tonight: 198.9k/200k), nothing client-side restores it — the fix removes the
  wasted round-trips and re-pokes, not the quota. The budget resets on Groq's
  schedule (daily).
- The chain's live-verification tests consume the shared free-tier budgets —
  by design (they prove real provider behavior), but it means heavy test days
  can leave the brain quota-poor for the evening.
- Hints are per-process memory; a restart re-learns them with one 429 each.
