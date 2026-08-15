# JEXI OS — Connectors (WhatsApp · GitHub · Email)

The connector layer gives JEXI OS real outbound channels with **verifiable**
credentials. Every connector exposes the same contract:

| Method | What it does |
|---|---|
| `healthCheck()` | Makes a **real** call to the provider's API and reports the actual result (`PASS` / `FAIL` / `BLOCKED`). Never passes on env presence alone. |
| `send(args)` | Fires a **real** outbound action (message / issue / email) and returns the provider's raw response. |
| `receive(rawBody)` | Parses an inbound webhook payload into a flat, structured shape. |

Source: `server/src/services/connectors/` (`email.js`, `whatsapp.js`,
`github.js`, `index.js`).

---

## HTTP surface

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/connectors` | open | Masked credential status for all three connectors (no values) |
| `GET /api/connectors/:name/health` | open | Real health check (calls the provider; read-only, no secrets) |
| `POST /api/connectors/:name/send` | API key (`x-jexi-key`) | Real test send (`{...args}` in the body) |
| `GET /webhooks/connectors/whatsapp` | none (Meta) | Meta verification handshake (`hub.challenge` + `VERIFY_TOKEN`) |
| `POST /webhooks/connectors/whatsapp` | HMAC (`x-hub-signature-256` with `APP_SECRET`) | Inbound WhatsApp messages |
| `POST /webhooks/connectors/github` | HMAC (`x-hub-signature-256` with `GITHUB_WEBHOOK_SECRET` or `GITHUB_TOKEN`) | GitHub webhook events |

Status + health are deliberately open (same class as `/api/health`) so you can
verify connectors **from a browser with zero shell access** — the checks run
inside the deployed server's process, where the env vars live. Test sends stay
API-key gated because they fire real messages.

Webhook routes are mounted **before** `express.json()` so HMAC signatures are
verified against the untouched raw body (see `mountConnectorWebhooks` in
`server/index.js`).

---

## Env vars

| Variable | Connector | Required | Where to get it |
|---|---|---|---|
| `RESEND_API_KEY` | Email | yes | https://resend.com/api-keys |
| `RESEND_FROM` | Email | no | Your verified sender (default: `JEXI OS <onboarding@resend.dev>`) |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp | yes | Meta App Dashboard → WhatsApp → API Setup |
| `PHONE_NUMBER_ID` | WhatsApp | yes | Meta App Dashboard → WhatsApp → API Setup |
| `APP_SECRET` | WhatsApp | yes | Meta App Dashboard → WhatsApp → App secret (HMAC for webhooks) |
| `VERIFY_TOKEN` | WhatsApp | yes | Any string you choose; Meta echoes it during webhook setup |
| `GITHUB_TOKEN` | GitHub | yes | https://github.com/settings/tokens (repo scope) |
| `GITHUB_WEBHOOK_SECRET` | GitHub | no | Webhook secret; defaults to `GITHUB_TOKEN` when unset |

All keys also fall back to `settings.json` (Settings → …) where a connector
reads a matching key (e.g. `githubToken`, `resendKey`, `whatsappToken`).

---

## Verify each connector — no shell required

Render's free tier has no shell/SSH console, and that's fine: the real checks
run **inside the deployed server** (where the env vars are), and you call them
over HTTPS from any browser. Deploy the new build to Render first, then open:

```
https://YOUR-RENDER-URL/api/connectors                → masked status for all 3
https://YOUR-RENDER-URL/api/connectors/whatsapp/health → real PASS/FAIL + detail
https://YOUR-RENDER-URL/api/connectors/github/health   → real username on PASS
https://YOUR-RENDER-URL/api/connectors/email/health    → real key check on PASS
```

Each health URL is a normal GET — open it in a phone browser, or curl it from
your laptop. A `PASS` means the provider answered the real API call; `FAIL`
carries the provider's exact error; `BLOCKED` means an env var is missing.

### Test sends (need the API key header if `JEXI_API_KEY` is set)

From your laptop (no shell on the server needed):

```bash
# Email — replace <key> with your JEXI access key if JEXI_API_KEY is set
curl -X POST https://YOUR-RENDER-URL/api/connectors/email/send \
  -H 'Content-Type: application/json' -H 'x-jexi-key: <key>' \
  -d '{"to":"you@example.com","subject":"test","html":"<p>hi</p>"}'

# WhatsApp — recipient must have messaged your number first (24h window)
curl -X POST https://YOUR-RENDER-URL/api/connectors/whatsapp/send \
  -H 'Content-Type: application/json' -H 'x-jexi-key: <key>' \
  -d '{"to":"15551234567","body":"Hello from JEXI!"}'

# GitHub issue in a disposable repo
curl -X POST https://YOUR-RENDER-URL/api/connectors/github/send \
  -H 'Content-Type: application/json' -H 'x-jexi-key: <key>' \
  -d '{"owner":"octocat","repo":"disposable-repo","title":"JEXI connector test","body":"real issue"}'
```

Each returns the provider's raw response (email id / WhatsApp message id /
GitHub issue number + URL). No JEXI_API_KEY on Render? Then drop the
`x-jexi-key` header entirely.

### Full live script (for any host where the keys exist)

If you ever have the env vars on a machine you can run commands on, the script
prints payloads + raw responses end to end:

```bash
cd server
RESEND_TEST_TO="you@example.com" \
WHATSAPP_TEST_TO="15551234567" \
GITHUB_TEST_REPO="owner/disposable-test-repo" \
node scripts/test-connectors-live.js
```

(Optional — the original Render-shell flow, for completeness:)

```bash
cd server
RESEND_TEST_TO="you@example.com" \
WHATSAPP_TEST_TO="15551234567" \
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
| WhatsApp | `GET https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,quality_rating,id` | 200 — token + phone number live |
| GitHub | `GET https://api.github.com/user` | 200 — returns the authenticated username |

---

## Webhook setup

### WhatsApp

1. Meta App Dashboard → **WhatsApp → Configuration → Webhook**.
2. Callback URL: `https://YOUR-RENDER-URL/webhooks/connectors/whatsapp`
3. Verify token: your `VERIFY_TOKEN` value.
4. Meta sends the `hub.challenge` handshake; the server echoes it back when the
   token matches.
5. Subscribe to the `messages` field. Inbound texts are HMAC-verified with
   `APP_SECRET` and parsed by `receive()`.

### GitHub

1. Repo → **Settings → Webhooks → Add webhook**.
2. Payload URL: `https://YOUR-RENDER-URL/webhooks/connectors/github`
3. Content type: `application/json`.
4. Secret: your `GITHUB_WEBHOOK_SECRET` value (or `GITHUB_TOKEN`).
5. Events: `Issues`, `Issue comments` (or *Send me everything* for testing).
   Each delivery carries `x-hub-signature-256`; the server verifies it against
   the raw body before `receive()` parses the event.

---

## Test suites

- `server/test-connectors.js` — offline (runs in `npm test`): payload shapes
  match provider docs, handshake + HMAC verification, `receive()` parsing,
  missing-key fail-closed behavior. No network, no keys.
- `server/scripts/test-connectors-live.js` — live end-to-end proof, run on the
  host that holds the keys (see above).
