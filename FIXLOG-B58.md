# FIXLOG-B58 — Live testing found: raw webhook parser was eating every POST body

## Context

Testing the B57 connectors live against `https://jexi-os-brain.onrender.com`
(the deployed Render server where the env vars live) showed `POST
/api/connectors/:name/call` returning "requires to" for every send — the JSON
body never reached the handler.

## Root cause (before → after)

`server/index.js` mounted the webhook router with an **unscoped** raw-body
parser:

```js
// BEFORE (B56, live since B56 — broke EVERY POST on the server):
const connectorWebhooks = express.Router();
connectorWebhooks.use(express.raw({ type: () => true, limit: '10mb' }));
```

`router.use()` at the router root runs for **every request** that enters the
router, and `app.use(connectorWebhooks)` mounts it at `/`. With
`type: () => true` the raw parser consumed the body of *every* request —
including `/api/chat`, `/api/tasks`, `/api/connectors/*/call` — so the
`express.json()` mounted later could never parse `req.body`. Every POST
endpoint on the server has been silently broken since B56 (GETs were fine).

```js
// AFTER (B57/B58): scope the raw parser to the webhook paths only.
connectorWebhooks.use('/webhooks/connectors', express.raw({ type: () => true, limit: '10mb' }));
```

Webhook HMAC verification still receives the untouched raw body; every other
route parses normally via `express.json()`.

Also wrapped `webhookFor()` in a try/catch — previously a webhook arriving
with no secret configured (e.g. GitHub without `GITHUB_WEBHOOK_SECRET`) threw
inside the async handler and the response hung; now it returns a proper
`500 {"ok":false,"error":...}`.

## Evidence

- Local boot smoke test: `POST /api/connectors/whatsapp/call {"method":"health"}`
  → parsed correctly (`method: "health"` honored, was defaulting to `send` before);
  `POST /webhooks/connectors/github` with no secret → `HTTP 500` JSON (was hanging).
- `cd server && npm test` → exit 0, connector suite 91/0.
- Live repro on Render: same POST returned `"WhatsApp send requires \"to\""`
  before the fix; re-tested after deploy in B59.

## Files

`server/index.js` (raw-body scoping + webhook error guard). Committed as B58.
