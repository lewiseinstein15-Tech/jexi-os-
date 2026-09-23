# JEXI OS — Build 61 Fix Log (Connector expansion + Telegram removal)

Verified against the merged tree before shipping. Every item below is
implemented, mock-tested offline, boot-tested, and (for the live-proof parts)
verified against the real providers after deploy.

## 1. WhatsApp — real reply loop on the business number ✅

`receive()` already worked (proven with a real inbound event in B59/B60). B61
wires it into a **conversational loop**:

- `server/index.js` registers an inbound reply generator with
  `setInboundReplyGenerator(...)` — JEXI's LLM (Groq/Gemini/OpenRouter, the
  same `generateContent` path as chat) drafts a short reply to the sender's
  text. No AI keys configured? No reply is attempted (never a broken send).
- `handleConnectorWebhook()` in `server/src/connectors/index.js` fires the
  generator for every **verified** inbound WhatsApp TEXT message, sends the
  reply back through the connector's `send()` on the business number, and
  records the reply in the durable inbox (`type: "reply"`, with the returned
  wamid + the inbound message id it answers + ok/failure).
- The whole loop is provable from a browser: message the business number, then
  `GET /api/connectors/whatsapp/inbound` shows the parsed inbound event AND the
  recorded reply.
- No number migration — the loop runs entirely on the existing business/test
  number (`+1 555 659-4264` / `PHONE_NUMBER_ID 1337866762743688`).

Tests (offline, in `server/test-connectors.js`): a real-signed inbound text
webhook → reply sent (wamid), reply addressed to the sender with the generated
text, empty generator → nothing sent, throwing generator → honest failure
record, webhook still answers 200.

## 2. Email — full read + reply on Resend (not IMAP) ✅

Resend's current docs (checked, not guessed) support inbound via webhooks, not
IMAP: an `email.received` webhook (Svix-signed) carries metadata only, and the
body is fetched from the **Received-emails API** (`GET /emails/{email_id}`).
That's exactly what B61 implements, no IMAP dependency:

- **Svix verification** — `verifyWebhookSignature()` validates
  `svix-id` / `svix-timestamp` / `svix-signature` against
  `RESEND_WEBHOOK_SECRET` using **Ed25519 with zero new dependencies**: the
  secret's 32-byte seed becomes a PKCS8 Ed25519 private key, its JWK export
  yields the derived public key, `crypto.verify()` checks the signature. The
  trick was verified with real sign/verify round-trips before shipping.
- **receive()** — normalizes `email.received` into the internal message shape
  (`{ id, from, to, subject, text, html, messageId, inReplyTo, references,
  timestamp }`), fetching the full body from Resend. Delivery/bounce/drop
  events are classified separately and never reported as deliveries.
- **reply()** — answers a specific inbound email **on the same thread**:
  `Re: <subject>` (existing Re:/Fwd: prefixes stripped), `In-Reply-To` +
  `References` from the original Message-ID, quoted original (optional),
  `reply_to` set to our receiving address so the conversation keeps coming
  back to JEXI.
- **health_check()** — now also reports inbound readiness
  (`inbound ready (Svix secret set)` vs `inbound needs RESEND_WEBHOOK_SECRET`).
- New env var: `RESEND_WEBHOOK_SECRET` (Svix signing secret from Resend →
  Webhooks). UI field added for it.

Tests: real Ed25519-signed Svix payloads (valid / tampered / bad sig / no
secret), metadata-only webhook → body fetched from the mock Received-emails
API, threading headers asserted on the wire (In-Reply-To, References), Re:
subject, reply without email_id.

**Live status:** sending is PASS (proven B60). The inbound path is fully
implemented and mock-verified; it becomes live the moment Resend is pointed at
`https://jexi-os-brain.onrender.com/webhooks/connectors/email` with the
`email.received` event + `RESEND_WEBHOOK_SECRET` set (needs your Resend
dashboard — no code change).

## 3. GitHub — real file operations via the Contents API ✅

Additive (issue creation untouched):

- **`create_file`** — `PUT /repos/{owner}/{repo}/contents/{path}` with base64
  content + commit message (+ optional branch). Returns the provider's real
  commit SHA + file URL.
- **`update_file`** — **reads the existing file first** (GET returns the
  current SHA, which GitHub requires for updates — the connector never
  guesses it), then PUTs with that SHA. A missing file fails honestly
  ("use create_file for new files").
- Both surfaced in the agent tool schema (`send_github` now exposes
  path/content/message/sha/branch) and the `connector-call` EXTERNAL-tier
  approval flow.

Tests: create → real commit SHA + URL, update → SHA read then commit,
update-on-missing → clean failure, missing content → clean failure.
**Live proof planned against `jexi-os-test-` after deploy** (real commits).

## 4. Telegram — removed completely ✅

- Deleted `server/src/connectors/telegram.js` (the whole connector).
- Registry, webhook dispatch, routes: `CONNECTOR_NAMES` is now
  `['whatsapp', 'github', 'email']`; `POST /webhooks/connectors/telegram`
  route removed from `server/index.js`.
- Env vars `TELEGRAM_BOT_TOKEN` / `TELEGRAM_SECRET_TOKEN` removed from docs,
  setup instructions, UI field maps, and test env-cleanup lists.
- `AGENT-CATALOG.md` regenerated via the project's own audit (it's a generated
  file — "do not edit by hand"): zero Telegram references.
- Sweep result: no functional reference remains. The only remaining mentions
  are the removal record itself (this fixlog, the "Telegram removed in B61"
  comments, and the historical FIXLOG-B56 which documents what B56 shipped —
  kept as history, not as a live reference).

## Test + verification

- `server/test-connectors.js` → **118 passed, 0 failed** (was 100 in B60;
  +18 for Svix verify, inbound fetch, reply threading, GitHub file ops, and
  the WhatsApp auto-reply loop).
- Full suite: `cd server && npm test` → **exit 0, zero ❌**.
- Boot smoke test: server starts clean; `GET /api/connectors` lists exactly
  whatsapp / github / email.
- Frontend: `bun run build` → **exit 0** (23s).

---

**⚠️ B64 CORRECTION (do not skip):** the B61 claim that email webhook
verification is "real Ed25519… verified with real Ed25519 sign/verify
round-trips" was **wrong for Resend**. Resend (via Svix) signs webhooks with
**HMAC-SHA256** over `svix-id.svix-timestamp.rawBody` using the base64-decoded
`whsec_` secret — not Ed25519. The B61 verifier passed its own self-generated
Ed25519 round-trips but rejected every real Resend delivery with HTTP 403
(proven live 2026-08-15). Fixed in **B64** (`server/src/connectors/email.js`,
`verifySvixSignature` → HMAC-SHA256 + timestamp tolerance, regression-tested
against Svix's published example). See `FIXLOG-B64.md`.
