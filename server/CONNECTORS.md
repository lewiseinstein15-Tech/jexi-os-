# JEXI OS — Connectors (GitHub · Email)

The connector layer gives JEXI OS real outbound + inbound channels with
**verifiable** credentials. Every connector implements the same contract:

| Method | What it does |
|---|---|
| `authenticate()` | Makes a **real** call to the provider's API (never just "key is present") |
| `healthCheck()` | Wraps `authenticate()` → `{ status: 'ok'\|'error', detail }` with the provider's real answer |
| `send(payload)` | Fires a **real** outbound action (email / issue / file commit) and returns the provider's raw response |
| `receive(body)` | Parses an inbound webhook payload into a flat, structured event shape |
| `reply(payload)` | Email only — answers a specific inbound email on the **same thread** (Re: subject, In-Reply-To + References, quoted original) |
| `verifyWebhookSignature()` | Per-provider inbound verification (GitHub HMAC / Resend Svix HMAC-SHA256) over the raw body |

Source: `server/src/connectors/` — `ConnectorBase.js`, `ConnectorRegistry.js`,
`github.js`, `email.js` (Resend), `toolBridge.js`, `index.js` (wiring).
The Telegram connector was removed in B61, and the Meta messaging connector
was removed in B66 (connector, registry entries, env vars, routes, tests,
docs — zero references remain).

---

## HTTP surface

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/connectors` | open (GET) | Masked status for every connector (no values) |
| `GET /api/connectors/:name/health` | open (GET) | Real health check (calls the provider; read-only, no secrets) |
| `GET /api/connectors/:name/inbound` | open (GET) | Recent verified inbound webhook events (newest first, no secrets) |
| `GET /api/connectors/:name/conversations` | open (GET) | Per-partner chat threads (inbound + our replies, both directions) |
| `POST /api/connectors/:name/call` | API key (`x-jexi-key`) | Real action: body `{ "method": "send"\|"receive"\|"reply"\|"health", "payload": {...} }` |
| `POST /api/connectors/:name/config` | API key | Save Settings-stored keys (env always wins at call time) |
| `POST /api/connectors/:name/toggle` | API key | Enable/disable a connector |
| `POST /webhooks/connectors/github` | HMAC (`x-hub-signature-256`/`sha1` with `GITHUB_WEBHOOK_SECRET`) | GitHub webhook events |
| `POST /webhooks/connectors/email` | Svix HMAC-SHA256 (`RESEND_WEBHOOK_SECRET`) | Resend inbound (`email.received`) + delivery events |

Status + health are deliberately open (same class as `/api/health`) so you can
verify connectors **from a browser with zero shell access** — the checks run
inside the deployed server's process, where the env vars live. Test sends stay
API-key gated because they fire real messages.

Webhook routes are mounted **before** `express.json()` so signatures are
verified against the untouched raw body (see the `connectorWebhooks` mount in
`server/index.js`).

---

## Env vars

| Variable | Connector | Required | Where to get it |
|---|---|---|---|
| `RESEND_API_KEY` | Email | yes | https://resend.com/api-keys (Full access for inbound fetch) |
| `RESEND_WEBHOOK_SECRET` | Email | inbound | Resend → Webhooks → signing secret (Svix `whsec_…`) |
| `RESEND_FROM` | Email | no | Verified sender. Default: Resend's documented test sender `onboarding@resend.dev` |
| `RESEND_RECEIVING_ADDRESS` | Email | no | Our receiving address (e.g. `jexi@yourdomain.com`); used as From when replying |
| `JEXI_CREATOR_EMAIL` | Email | no | The sender JEXI recognizes as her creator (default `lewiseinstein15@gmail.com` — Lewis) |
| `GITHUB_TOKEN` (or `GH_TOKEN`) | GitHub | yes (PAT) | https://github.com/settings/tokens (repo scope) |
| `GITHUB_WEBHOOK_SECRET` | GitHub | no | Webhook secret; falls back to `GITHUB_TOKEN` when unset |
| `GITHUB_APP_ID` + `GITHUB_PRIVATE_KEY` + `GITHUB_INSTALLATION_ID` | GitHub | alt | GitHub App auth instead of a PAT |

All keys also fall back to `settings.json` (Settings → Connectors UI); an
**unset** env var never clobbers a stored value.

---

## Verify each connector — no shell required

Render's free tier has no shell/SSH console, and that's fine: the real checks
run **inside the deployed server** (where the env vars are), and you call them
over HTTPS from any browser. Deploy the new build to Render first, then open:

```
https://YOUR-RENDER-URL/api/connectors                  → masked status for all connectors
https://YOUR-RENDER-URL/api/connectors/github/health    → real username on PASS
https://YOUR-RENDER-URL/api/connectors/email/health     → real Resend key check on PASS
https://YOUR-RENDER-URL/api/connectors/email/inbound    → every webhook Resend delivered to JEXI, parsed + newest first
```

Each health URL is a normal GET — open it in a phone browser, or curl it from
your laptop. A `PASS` means the provider answered the real API call; `FAIL`
carries the provider's exact error; `NOT_CONFIGURED` names the missing env var.

### Test sends (need the `x-jexi-key` header if `JEXI_API_KEY` is set)

From your laptop (no shell on the server needed):

```bash
# Email — replace <key> with your JEXI access key if JEXI_API_KEY is set
curl -X POST https://YOUR-RENDER-URL/api/connectors/email/call \
  -H 'Content-Type: application/json' -H 'x-jexi-key: <key>' \
  -d '{"method":"send","payload":{"to":"you@example.com","subject":"test","html":"<p>hi</p>"}}'

# GitHub — create a real file commit (returns commit SHA + file URL)
curl -X POST https://YOUR-RENDER-URL/api/connectors/github/call \
  -H 'Content-Type: application/json' -H 'x-jexi-key: <key>' \
  -d '{"method":"send","payload":{"action":"create_file","owner":"octocat","repo":"disposable-repo","path":"notes.md","content":"# Notes\nhello","message":"JEXI created this file"}}'

# GitHub — update that file (reads the current SHA first, commits the change)
curl -X POST https://YOUR-RENDER-URL/api/connectors/github/call \
  -H 'Content-Type: application/json' -H 'x-jexi-key: <key>' \
  -d '{"method":"send","payload":{"action":"update_file","owner":"octocat","repo":"disposable-repo","path":"notes.md","content":"# Notes\nupdated by JEXI","message":"JEXI updated this file"}}'
```

Each returns the provider's raw response (email id / GitHub commit SHA + URL).
No `JEXI_API_KEY` on Render? Then drop the `x-jexi-key` header entirely.

### Full live script (for any host where the keys exist)

```bash
cd server
RESEND_TEST_TO="you@example.com" \
GITHUB_TEST_REPO="owner/disposable-test-repo" \
node scripts/test-connectors-live.js
```

Per-connector `health_check()`:

| Connector | Real call | PASS means |
|---|---|---|
| Email | `GET https://api.resend.com/domains` | 200 — key valid, lists configured domains (inbound note when `RESEND_WEBHOOK_SECRET` is set) |
| GitHub | `GET https://api.github.com/user` | 200 — returns the authenticated username |

---

## Webhook setup

### GitHub

1. Repo → **Settings → Webhooks → Add webhook**.
2. Payload URL: `https://YOUR-RENDER-URL/webhooks/connectors/github`
3. Content type: `application/json`.
4. Secret: your `GITHUB_WEBHOOK_SECRET` value (or `GITHUB_TOKEN`).
5. Events: `Issues`, `Issue comments` (or *Send me everything* for testing).
   Each delivery carries `x-hub-signature-256`; the server verifies it against
   the raw body before `receive()` parses the event.

### Email (Resend) — inbound read + reply (PRIMARY channel)

1. Resend dashboard → **Emails → Receiving** — get your receiving address
   (`anything@<your-id>.resend.app` or your own domain with the MX record).
2. Resend dashboard → **Webhooks** → **Add Webhook**.
3. URL: `https://YOUR-RENDER-URL/webhooks/connectors/email`
4. Event: **`email.received`** (this is what makes read + reply work; delivery
   events are classified separately and never reported as deliveries).
5. Copy the webhook **signing secret** (Svix `whsec_…`) into
   `RESEND_WEBHOOK_SECRET` on Render — every delivery is verified with the
   Svix HMAC-SHA256 scheme before `receive()` parses it (B64: corrected from the Ed25519 misread in B61).
6. Every `email.received` webhook carries metadata only; the connector then
   calls Resend's **Received-emails API** (`GET /emails/receiving/{email_id}`, B65 fix) for the
   full body and normalizes it into the internal message shape.
7. **`reply()`** answers on the same thread: `Re: <subject>`, `In-Reply-To` +
   `References` headers, quoted original, `reply_to` = our receiving address —
   so the conversation keeps coming back to JEXI.
8. **Creator recognition (B66):** inbound emails whose sender is
   `lewiseinstein15@gmail.com` (default `JEXI_CREATOR_EMAIL`) are flagged
   `creator: true` — JEXI treats them as coming from Lewis, her creator,
   with creator-aware tone/priority. This recognition never bypasses the
   normal approval/safety gates.

---

## Proving inbound (receive) works — no shell needed

Every verified webhook delivery is recorded in a durable inbox
(`DATA_DIR/connector-inbox.json`) and readable at
`GET /api/connectors/:name/inbound` from any browser:

```
https://YOUR-RENDER-URL/api/connectors/email/inbound
```

→ `{ events: [ { at, id, provider, from, to, type, text, timestamp, creator? } ], total }`

So the loop "Gmail → Resend → webhook → JEXI → auto-reply → Gmail (same
thread)" is fully provable: email the receiving address, then open that URL
and the parsed event **and** the recorded `type: "reply"` are both there.

> ⚠️ Corrupted keys: if a health check reports "contains non-ASCII
> characters (e.g. an emoji)", the env value was corrupted during copy-paste.
> Re-paste the key fresh from the provider dashboard — no other fix needed.

## Test suites

- `server/test-connectors.js` — offline (runs in `npm test`): payload shapes
  match provider docs, handshake + HMAC/Svix verification, `receive()` parsing
  (including fetching the received email body), `reply()` threading headers,
  GitHub Contents-API create/update (SHA read), the email auto-reply loop,
  creator recognition, conversation-thread grouping, error paths executed
  (401/429/500/malformed/…) against the local mock server
  (`server/tests/connectorMocks.js`).
