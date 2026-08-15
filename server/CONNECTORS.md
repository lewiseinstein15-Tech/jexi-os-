# JEXI OS — Connectors (WhatsApp · GitHub · Email · Telegram)

The connector layer gives JEXI OS real outbound channels with **verifiable**
credentials. Every connector implements the same contract:

| Method | What it does |
|---|---|
| `authenticate()` | Makes a **real** call to the provider's API (never just "key is present") |
| `healthCheck()` | Wraps `authenticate()` → `{ status: 'ok'\|'error', detail }` with the provider's real answer |
| `send(payload)` | Fires a **real** outbound action (message / issue / email) and returns the provider's raw response |
| `receive(body)` | Parses an inbound webhook payload into a flat, structured event shape |

Source: `server/src/connectors/` — `ConnectorBase.js`, `ConnectorRegistry.js`,
`whatsapp.js`, `github.js`, `email.js` (Resend), `telegram.js`, `toolBridge.js`,
`index.js` (wiring).

---

## HTTP surface

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/connectors` | open (GET) | Masked status for every connector (no values) |
| `GET /api/connectors/:name/health` | open (GET) | Real health check (calls the provider; read-only, no secrets) |
| `GET /api/connectors/:name/inbound` | open (GET) | B59 — recent verified inbound webhook events + Meta handshake records (newest first, no secrets) |
| `POST /api/connectors/:name/call` | API key (`x-jexi-key`) | Real action: body `{ "method": "send"\|"health"\|"receive", "payload": {...} }` |
| `POST /api/connectors/:name/config` | API key | Save Settings-stored keys (env always wins at call time) |
| `POST /api/connectors/:name/toggle` | API key | Enable/disable a connector |
| `GET /webhooks/connectors/whatsapp` | none (Meta) | Meta verification handshake (`hub.challenge` + verify token) |
| `POST /webhooks/connectors/whatsapp` | HMAC (`x-hub-signature-256` with app secret) | Inbound WhatsApp messages |
| `POST /webhooks/connectors/github` | HMAC (`x-hub-signature-256`/`sha1` with `GITHUB_WEBHOOK_SECRET`) | GitHub webhook events |
| `POST /webhooks/connectors/email` | none (Resend) | Resend delivery-event webhook (delivered / bounced / dropped / complained) |
| `POST /webhooks/connectors/telegram` | `X-Telegram-Bot-Api-Secret-Token` | Telegram updates |

Status + health are deliberately open (same class as `/api/health`) so you can
verify connectors **from a browser with zero shell access** — the checks run
inside the deployed server's process, where the env vars live. Test sends stay
API-key gated because they fire real messages.

Webhook routes are mounted **before** `express.json()` so HMAC signatures are
verified against the untouched raw body (see the `connectorWebhooks` mount in
`server/index.js`).

---

## Env vars

| Variable | Connector | Required | Where to get it |
|---|---|---|---|
| `RESEND_API_KEY` | Email | yes | https://resend.com/api-keys |
| `RESEND_FROM` | Email | no | Verified sender. Default: Resend's documented test sender `onboarding@resend.dev` |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp | yes | Meta App Dashboard → WhatsApp → API Setup |
| `PHONE_NUMBER_ID` (or `WHATSAPP_PHONE_NUMBER_ID`) | WhatsApp | yes | Meta App Dashboard → WhatsApp → API Setup |
| `APP_SECRET` (or `WHATSAPP_APP_SECRET`) | WhatsApp | yes | Meta App Dashboard → App secret (HMAC for webhooks) |
| `VERIFY_TOKEN` (or `WHATSAPP_VERIFY_TOKEN`) | WhatsApp | yes | Any string you choose; Meta echoes it during webhook setup |
| `GITHUB_TOKEN` (or `GH_TOKEN`) | GitHub | yes (PAT) | https://github.com/settings/tokens (repo scope) |
| `GITHUB_WEBHOOK_SECRET` | GitHub | no | Webhook secret; falls back to `GITHUB_TOKEN` when unset |
| `GITHUB_APP_ID` + `GITHUB_PRIVATE_KEY` + `GITHUB_INSTALLATION_ID` | GitHub | alt | GitHub App auth instead of a PAT |
| `TELEGRAM_BOT_TOKEN` | Telegram | yes | @BotFather |
| `TELEGRAM_SECRET_TOKEN` | Telegram | no | Webhook secret token |

All keys also fall back to `settings.json` (Settings → Connectors UI); an
**unset** env var never clobbers a stored value.

---

## Verify each connector — no shell required

Render's free tier has no shell/SSH console, and that's fine: the real checks
run **inside the deployed server** (where the env vars are), and you call them
over HTTPS from any browser. Deploy the new build to Render first, then open:

```
https://YOUR-RENDER-URL/api/connectors                  → masked status for all connectors
https://YOUR-RENDER-URL/api/connectors/whatsapp/health  → real PASS/FAIL + detail
https://YOUR-RENDER-URL/api/connectors/github/health    → real username on PASS
https://YOUR-RENDER-URL/api/connectors/email/health     → real Resend key check on PASS
https://YOUR-RENDER-URL/api/connectors/whatsapp/inbound → B59 — every webhook Meta delivered to JEXI, parsed + newest first
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

# WhatsApp — recipient must have messaged your number first (24h window)
curl -X POST https://YOUR-RENDER-URL/api/connectors/whatsapp/call \
  -H 'Content-Type: application/json' -H 'x-jexi-key: <key>' \
  -d '{"method":"send","payload":{"to":"2547XXXXXXXX","type":"text","text":"Hello from JEXI!"}}'

# GitHub issue in a disposable repo
curl -X POST https://YOUR-RENDER-URL/api/connectors/github/call \
  -H 'Content-Type: application/json' -H 'x-jexi-key: <key>' \
  -d '{"method":"send","payload":{"action":"create_issue","owner":"octocat","repo":"disposable-repo","title":"JEXI connector test","body":"real issue"}}'
```

Each returns the provider's raw response (email id / WhatsApp wamid / GitHub
issue number + URL). No `JEXI_API_KEY` on Render? Then drop the `x-jexi-key`
header entirely.

### Full live script (for any host where the keys exist)

If you ever have the env vars on a machine you can run commands on, the script
prints payloads + raw responses end to end:

```bash
cd server
RESEND_TEST_TO="you@example.com" \
WHATSAPP_TEST_TO="2547XXXXXXXX" \
GITHUB_TEST_REPO="owner/disposable-test-repo" \
node scripts/test-connectors-live.js
```

The script prints, per connector: env presence (masked), the **real**
`health_check()` result, the **exact payload sent**, and the **raw provider
response** (message id / issue number / email id). It also demonstrates the
webhook handshake and HMAC verification running, and prints the curl commands
for the deployed `/webhooks/connectors/*` endpoints.

Per-connector `health_check()`:

| Connector | Real call | PASS means |
|---|---|---|
| Email | `GET https://api.resend.com/domains` | 200 — key valid, lists configured domains |
| WhatsApp | `GET https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}?fields=id,display_phone_number,verified_name` | 200 — token + phone number live |
| GitHub | `GET https://api.github.com/user` | 200 — returns the authenticated username |
| Telegram | `GET https://api.telegram.org/bot<token>/getMe` | 200 — bot token valid |

---

## Webhook setup

### WhatsApp

1. Meta App Dashboard → **WhatsApp → Configuration → Webhook**.
2. Callback URL: `https://YOUR-RENDER-URL/webhooks/connectors/whatsapp`
3. Verify token: your `VERIFY_TOKEN` value.
4. Meta sends the `hub.challenge` handshake; the server echoes it back when the
   token matches.
5. Subscribe to the `messages` field. Inbound texts are HMAC-verified with the
   app secret and parsed by `receive()`.

### GitHub

1. Repo → **Settings → Webhooks → Add webhook**.
2. Payload URL: `https://YOUR-RENDER-URL/webhooks/connectors/github`
3. Content type: `application/json`.
4. Secret: your `GITHUB_WEBHOOK_SECRET` value (or `GITHUB_TOKEN`).
5. Events: `Issues`, `Issue comments` (or *Send me everything* for testing).
   Each delivery carries `x-hub-signature-256`; the server verifies it against
   the raw body before `receive()` parses the event.

### Email (Resend)

1. Resend dashboard → **Webhooks** → add webhook.
2. URL: `https://YOUR-RENDER-URL/webhooks/connectors/email`
3. Events: `email.delivered`, `email.bounced`, `email.dropped`,
   `email.complained`, `email.sent`.
   Deliveries/bounces/drops are classified distinctly — a bounce is never
   reported as a delivery.

### Telegram

1. Tell @BotFather to set the webhook, with your secret token as
   `X-Telegram-Bot-Api-Secret-Token`:
   `https://api.telegram.org/bot<token>/setWebhook?url=https://YOUR-RENDER-URL/webhooks/connectors/telegram&secret_token=YOUR_TELEGRAM_SECRET_TOKEN`
2. Every update is verified against that secret before parsing.

---

## Proving inbound (receive) works — no shell needed

Every verified webhook delivery and every Meta hub.challenge handshake is
recorded in a durable inbox (`DATA_DIR/connector-inbox.json`) and readable at
`GET /api/connectors/:name/inbound` from any browser:

```
https://YOUR-RENDER-URL/api/connectors/whatsapp/inbound
```

→ `{ events: [ { at, id, provider, from, to, type, text, timestamp } ],
handshakes: [ { at, verified, reason?, challenge? } ], total }`

So the loop "phone → WhatsApp → Meta webhook → JEXI" is fully provable:
message the business number, then open that URL and the parsed event is there.

> ⚠️ Corrupted keys: if a health check reports "contains non-ASCII
> characters (e.g. an emoji)", the env value was corrupted during copy-paste.
> Re-paste the key fresh from the provider dashboard — no other fix needed.

## Test suites

- `server/test-connectors.js` — offline (runs in `npm test`): payload shapes
  match provider docs, handshake + HMAC verification, `receive()` parsing,
  error paths executed (401/429/500/malformed/timeout). No network, no keys.
- `server/scripts/test-connectors-live.js` — live end-to-end proof, run on the
  host that holds the keys (see above).
