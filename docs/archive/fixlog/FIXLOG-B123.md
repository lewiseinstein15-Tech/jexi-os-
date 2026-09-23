# FIXLOG-B123 — Fresh APK on EVERY deploy + live confirmation searching is fixed

**Phase:** B123 · **Branch:** main

## 1. Live confirmation: simple questions no longer search (from the live event log)
Checked the live server's event log before/after the B121 fix:

- **Before (crash era):** `Hello` → `error: Cannot access 'mode' before initialization` (18:58, 19:21).
- **After the fix:** `Hello`, `What is your name`, `Who are you`, `5+2`, `weather in Nairobi`, `weather in Tokyo`, `100usd to ksh`, `time in machakos county`, `whaf is the price of Bitcoin` → **zero errors, zero web-search tool calls**. The only coworker call in the window was `What is my name` → memory coworker (a direct model answer with memory — correct, not a search).
- Conclusion: AUTO routing is live — simple questions answer directly with the chat model; no search, no agents.

## 2. Every deploy now ships a fresh APK update
The APK workflow only built when `src/**`, `android/**`, `package.json`, `capacitor.config.json`, or the workflow itself changed — so server-only/plugin deploys never produced a new APK and the in-app update banner had nothing newer to offer.

Fix: `apk.yml` now builds on **every push to main** (`paths-ignore` only for markdown/docs). Every deploy → new `apk-build-NN` GitHub Release → the installed app's UpdateBanner ("UPDATE TO BUILD #N", via `/api/update/version` + the latest-release check) tells you to update, and `releases/latest/download/app-debug.apk` is always the newest build.

## Verification
- apk.yml paths-ignore change committed; this push triggers CI + Pages + a fresh APK build.
- After the build: release tag increments; `/api/update/version` returns the new tag.
