# FIXLOG-B57 — Email connector switched SendGrid → Resend + connector verification pass

## Context

B56 shipped the email connector on SendGrid. The SendGrid account was rejected
during provider vetting — JEXI does not use SendGrid at all. This build removes
every SendGrid reference from the live code path and replaces the connector
with Resend, using Resend's documented API schema (confirmed against
https://resend.com/docs/api-reference/emails/send-email).

Also verified the B56 connector claims (see "B56 verification" below) and
aligned the WhatsApp env vars with what is actually set in Render.

## Changes (before → after)

### 1. Email connector rewritten for Resend — `server/src/connectors/email.js`
- **Before (B56):** SendGrid REST — `POST /v3/mail/send` (202 + X-Message-Id),
  auth via `GET /v3/scopes`, `SENDGRID_API_KEY`, Inbound Parse multipart webhook.
- **After (B57):** Resend — `POST https://api.resend.com/emails` with
  `{ from, to[], subject, html|text }` → `{ id }`; `authenticate()` calls
  `GET https://api.resend.com/domains` (a REAL call — 200 = key valid, lists
  domains); `handleEvents()`/`normalizeInbound()` classify Resend delivery
  events (`email.delivered` / `bounced` / `dropped` / `complained` / `sent`),
  never conflating bounces with deliveries. `RESEND_API_KEY` (+ optional
  `RESEND_FROM`). From-chain fallback: payload → `RESEND_FROM` → settings
  `defaultFrom` → Resend's documented test sender `onboarding@resend.dev`.

### 2. Test suite + mocks updated — `server/tests/connectorMocks.js`, `server/test-connectors.js`
- SendGrid mock (`/v3/scopes`, `/v3/mail/send`) → Resend mock
  (`GET /domains`, `POST /emails`) with the same sentinel-token error paths
  (bad-/ratelimit-/fail-/malformed-).
- Email acceptance section rewritten: authenticate against `/domains`,
  send against `/emails` (asserts the real `id` shape), no-from fallback,
  subject-required, 401/429/500/malformed paths executed, delivery-webhook
  classification, `receive()` normalization.
- Env cleanup list: `SENDGRID_API_KEY` → `RESEND_API_KEY` + `RESEND_FROM`.

### 3. WhatsApp env var alignment — `server/src/connectors/whatsapp.js`
- **Before:** read only `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_VERIFY_TOKEN`.
- **After:** reads the short names `PHONE_NUMBER_ID`, `APP_SECRET`,
  `VERIFY_TOKEN` (what is actually set in Render) with the `WHATSAPP_*` forms
  taking precedence when both exist. UI hints updated to show both names.

### 4. Open health endpoints — `server/index.js`
- `GET /api/connectors` and new `GET /api/connectors/:name/health` are open
  (GET-only, read-only, masked secrets) so connectors can be verified from a
  browser with no shell access (Render free tier has no shell). Sends/config/
  toggle stay API-key gated.

### 5. Cleanup — removed superseded duplicate connector layer
- `server/src/services/connectors/*` (email/whatsapp/github/index.js) was an
  earlier standalone implementation, orphaned once the B56
  `server/src/connectors/*` registry became canonical. Removed; live script +
  docs rewritten against the B56 API.

### 6. Docs + live script
- `server/CONNECTORS.md` rewritten for the B56 architecture + Resend.
- `server/scripts/test-connectors-live.js` rewritten against
  `ConnectorRegistry` (real health checks + sends where the keys live).

### 7. Removed duplicate/superseded files (all logged, none referenced)
- **Duplicate core skill folders** `server/skills/{product,engineer,coder,qa,
  reviewer,security-officer,reflector}` — my pre-sync B50 copies diverged from
  the canonical versions the remote ships inside
  `server/plugins/coding-pipeline/skills/` and caused the B52 suite's OWASP
  planning-leak check to fail (my `security-officer/SKILL.md` description
  contained a reference-only phrase). Removed; the plugin copies (identical to
  remote) resolve for every skill. `test-skill-progressive.js` back to 65/0.
- **`server/src/services/KnowledgeFiles.js` + `server/knowledge/{architecture,
  conventions}/*.md` + `server/scripts/b50-*.mjs`** — my pre-sync B50 WIP.
  The canonical B56 tree implements knowledge differently (KNOWLEDGE.md
  category indexes + MemoryManager recursive indexing) and has no live
  callers for these paths (`knowledge-load` tool was never registered in the
  merged tree). Removed so the tree matches the canonical remote build; full
  suite still exit 0.

## B56 verification (claims checked against the merged tree)

- [x] `cd server && node test-connectors.js` → all pass (now with Resend paths; count adjusted)
- [x] `cd server && npm test` → exit 0 (full suite)
- [x] `authenticate()` really calls the provider (mock): WhatsApp Graph,
      GitHub `/user` (PAT + App JWT→install token), Resend `/domains`, Telegram getMe
- [x] One successful `send()` per connector with the provider response shape
- [x] `receive()`/webhook parse per connector (WhatsApp entry→message, GitHub
      push/issues/PR, Resend delivery events, Telegram updates)
- [x] Failure paths executed: 401→AUTH_FAILED, 429→RATE_LIMITED, hang→TIMEOUT,
      refused→NETWORK, wrong-shape 200→MALFORMED_RESPONSE, 5xx→PROVIDER_ERROR
- [x] Webhook signature verification executed: WhatsApp X-Hub-Signature-256 +
      hub.challenge handshake; GitHub sha256 + legacy sha1 + tampered;
      Telegram secret token
- [x] `connector-call` agent tool is EXTERNAL-tier: approval required with real
      details, confirm(true) runs, confirm(false) declines, unknown connector
      fails honestly
- [x] Secrets masked in every API/UI response; settings.json restored by tests

## Test evidence

```
$ cd server && npm test
exit 0 — every suite green, including the connector suite (Resend paths)
```

## Not broken

Existing B49–B56 suites, permission profiles, RiskGuard, graph orchestrator,
planner routing, tool gating all still pass. No existing tool or endpoint was
removed (only the orphaned standalone connector copies).
