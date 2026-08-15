# JEXI OS — Build 59 Fix Log (Live connector verification round 3)

Everything below was found by running REAL live calls against the deployed
Render server (`https://jexi-os-brain.onrender.com`) — not by code review.

---

## 1. RESEND_API_KEY on Render was corrupted (live email breakage) ✅

**Symptom (live):** `GET /api/connectors/email/health` and every email send
failed with an opaque Node error:

```
Network error talking to Resend API: Cannot convert argument to a ByteString
because the character at index 110 has a value of 9989 which is greater than 255.
```

**Root cause:** char 9989 = U+2705 ✅. The `RESEND_API_KEY` value stored in
Render's environment contains a stray **emoji character** from copy-paste
(when pasting the new Full-access key, an extra character rode along). Node's
`fetch` refuses to serialize a non-ASCII header, so every Resend call died
before leaving the server — the key itself was never actually sent.

**Fixed (defense in depth):**
- New `assertAsciiSecret()` in `server/src/connectors/ConnectorBase.js` —
  rejects any credential containing non-ASCII characters with a clear message
  that names the variable and tells the operator to re-paste it.
- Wired into `resolveAuth()` for **email (RESEND_API_KEY), WhatsApp
  (access token + app secret), and GitHub (token)** so the same corruption can
  never again surface as a cryptic ByteString error on any connector.
- The health endpoint now reports: *"RESEND_API_KEY contains non-ASCII
  characters … the stored value is corrupted. Re-paste …"*

**Action needed (operator):** re-paste the Resend key in Render →
Environment → `RESEND_API_KEY` (copy it fresh from the Resend dashboard, make
sure nothing extra is in the field), save, redeploy. Health will then PASS.

## 2. Provable inbound webhook log (receive() end-to-end) ✅

**Problem:** WhatsApp/email/GitHub webhook POSTs were verified and parsed, but
there was no way to observe an inbound delivery without Render log access —
so "receive() works" could not be proven live.

**Fixed:**
- New `server/src/services/ConnectorInbox.js` — durable, bounded log of
  normalized inbound webhook events and Meta hub.challenge handshakes,
  persisted to `DATA_DIR/connector-inbox.json` (survives restarts, capped at
  100 events + 25 handshakes per connector; raw provider envelopes are
  stripped — only normalized events are stored).
- `handleConnectorWebhook()` now records every verified event and every
  handshake (success + failure) and every signature rejection.
- New open read endpoint: `GET /api/connectors/:name/inbound` → newest-first
  `{ events, handshakes, total }`. GET-only, read-only, no secrets — same
  class as the open health endpoints.
- This lets a real WhatsApp message from a phone be proven end-to-end: Meta
  POSTs → signature verified → `normalizeInbound()` → event stored → visible
  at `/api/connectors/whatsapp/inbound` with `from`, `text`, `type`,
  `timestamp`.

## 3. GitHub `create_issue` → 404 (not a code bug)

**Live result:** `POST /api/connectors/github/call` with
`{ action: create_issue, owner: lewiseinstein15-Tech, repo: jexi-os-test }`
returned `HTTP 404 Not Found`. The GitHub API cannot resolve
`lewiseinstein15-Tech/jexi-os-test` publicly, and `gh` confirms it does not
exist under that name. Either the repo was created under a different
owner/name, or it is private and the token on Render is not a collaborator.
Needs the exact repo name + confirmation of the token's account before the
send test can pass.

## 4. Verified working (unchanged from B58)

- WhatsApp health PASS (real Graph API call), send PASS (Meta wamid returned,
  message delivered to +254117977415).
- GitHub health PASS (real `GET /user`).
- Meta webhook handshake: Meta shows the green checkmark, meaning the GET
  verification request reached `/webhooks/connectors/whatsapp` and our handler
  echoed the hub.challenge (a bogus token returns 403 `hub.verify_token
  mismatch`, verified live).

## Verification

- `cd server && node test-connectors.js` → **98 passed / 0 failed** (7 new
  B59 checks: ASCII-secret guard x2, corrupted-key health error, inbox
  record/list/strip/reset).
- `cd server && npm test` → **exit 0** (full suite, all sections).
- Server boots cleanly with the new route and inbox module.
