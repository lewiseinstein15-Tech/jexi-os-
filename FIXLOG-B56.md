# FIXLOG-B56 — Jexi Connector System (Plugin/Connector upgrade)

## Adaptation note (Python directive → this codebase)

The directive specifies Python (`core/connector_base.py`, `abc.ABC`, `dataclass`,
`async def`, FastAPI/Flask). **JEXI is a Node/Express (ESM) + React codebase** —
there is no Python anywhere in the repo, the deploy host is a Node-only image,
and the agent framework agents must call into (`ToolRuntime` / `AgentLoop`) is
JavaScript. Implementing the directive in Python would have produced a dead,
unreachable parallel system. The directive's architecture is therefore mapped
1:1 into `server/src/connectors/`:

| Directive (Python) | JEXI implementation (JS/ESM) |
|---|---|
| `core/connector_base.py` (ConnectorConfig, Connector ABC) | `server/src/connectors/ConnectorBase.js` — `ConnectorConfig` + `Connector` base + shared `httpJson`/`withTimeout` + error taxonomy (AUTH_FAILED, RATE_LIMITED, TIMEOUT, NETWORK, MALFORMED_RESPONSE, PROVIDER_ERROR, NOT_CONFIGURED) |
| `core/connector_registry.py` (register/get/list) | `server/src/connectors/ConnectorRegistry.js` — same API; every connector calls `register()` on load |
| WhatsApp Business Cloud API | `server/src/connectors/whatsapp.js` — Graph API auth/send, `hub.challenge` handshake, `X-Hub-Signature-256` verify |
| Email (SMTP+IMAP or SendGrid/Mailgun) | `server/src/connectors/email.js` — **SendGrid** REST send (no new deps) + Inbound Parse webhook (dependency-free multipart parser) + distinct bounce/drop/failure classification |
| GitHub (PAT or App) | `server/src/connectors/github.js` — PAT **and** GitHub App (RS256 JWT → installation token with refresh-on-expiry); create_issue / create_comment / create_pr / create_commit (blob→tree→commit→ref); `X-Hub-Signature-256` + legacy `sha1=` |
| "Others" (must be concrete) | **Telegram** — `server/src/connectors/telegram.js` (getMe auth, sendMessage/sendPhoto/sendDocument, webhook secret-token + getUpdates polling) |
| `core/tool_bridge.py` `connector_to_tool_schema` | `server/src/connectors/toolBridge.js` — introspects the connector's **actual** `send()` signature (`Function#toString` param parsing), merges the connector's `sendSchema()` metadata → OpenAI-style `send_whatsapp` / `send_github` / `send_email` / `send_telegram` tools |
| Agent-facing tool interface | `connector-call` tool wired into `ToolRegistry.js` + `ToolRuntime.js`: **EXTERNAL-tier** (B55 OpenWorker model) — every agent-initiated send pauses for ONE human approval with the real finalized details; `receive`/`health` are READ-tier |
| Webhook endpoints (FastAPI/Flask routes) | Express routes at `/webhooks/connectors/{whatsapp|github|email|telegram}` mounted **before** `express.json` (raw body required for HMAC verification), outside `/api` so provider webhooks bypass the API key + rate limiter |

## Non-negotiable rule — live vs mock disclosure

**Nothing in this build was tested against a live provider API.** No WhatsApp /
SendGrid / Telegram credentials exist in the project, and the GitHub token used
by the app is the user's own (not for CI tests). Per the directive, the full
integration code is written and a test harness proves it against **clearly
labeled local mock servers** (`server/tests/connectorMocks.js`) that mimic the
real providers' wire shapes. The connector code paths are byte-identical to
production: the only difference is `auth.baseUrl`, which defaults to the real
provider URL when unset. Error paths were **executed**, not just written
(auth 401, rate-limit 429, timeout, malformed 200-with-wrong-shape, provider
5xx) by driving the mocks with sentinel tokens.

### What you need to go live (env vars — set in Render or the Connectors UI)

| Connector | Env / Settings keys |
|---|---|
| WhatsApp | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` |
| GitHub | `GITHUB_TOKEN` (PAT) or `GITHUB_APP_ID` + `GITHUB_PRIVATE_KEY` + `GITHUB_INSTALLATION_ID`; `GITHUB_WEBHOOK_SECRET` |
| Email | `SENDGRID_API_KEY` (plus a verified sender in SendGrid) |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_SECRET_TOKEN` |

Env vars always win over Settings-stored values (and an unset env var never
clobbers a configured value — a bug found and fixed by the test suite).
Webhook URLs to register with each provider (JEXI verifies signatures on
every POST):
- WhatsApp: `https://<your-host>/webhooks/connectors/whatsapp`
- GitHub:   `https://<your-host>/webhooks/connectors/github`
- SendGrid: `https://<your-host>/webhooks/connectors/email`
- Telegram: `https://<your-host>/webhooks/connectors/telegram`

## Directive verification checklist

```
$ cd server && node test-connectors.js
RESULT: 91 passed, 0 failed        ← every connector + registry + tool bridge + gating

$ cd server && npm test            ← full suite
npm test exit: 0  (0 ❌ across every suite; roster audit: 251 agents · 507 skills · 177 tools)

$ npm run build                    ← frontend (new Connectors screen + nav + route)
✓ built in 24.62s
```

Per connector (all against the labeled mocks, error paths executed):

- [x] `authenticate()` actually calls the provider: WhatsApp Graph (`GET /{phone_number_id}`), GitHub (`GET /user` via PAT **and** App install token), SendGrid (`GET /v3/scopes`), Telegram (`GET /getMe`)
- [x] One successful `send()` with the logged provider response: `wamid.mock.*` / issue `#101` / comment `4242` / PR `#7` / commit `commitsha1` / `X-Message-Id` / `message_id 99`
- [x] One successful `receive()`/webhook parse with normalized output: WhatsApp entry→message, GitHub push/issues/pull_request, SendGrid multipart→message, Telegram update + getUpdates polling
- [x] Failure cases executed: 401→AUTH_FAILED, 429→RATE_LIMITED (retry-after surfaced, incl. Telegram's nested `parameters.retry_after`), hang→TIMEOUT (configurable `requestTimeout`), connection refused→NETWORK, wrong-shape 200→MALFORMED_RESPONSE, 5xx→PROVIDER_ERROR
- [x] Webhook signature verification executed: WhatsApp `X-Hub-Signature-256` (valid + tampered + missing) + `hub.challenge` handshake; GitHub sha256 + legacy sha1 + tampered; Telegram secret-token + mismatch
- [x] `connector_to_tool_schema` introspection: `send()` params parsed from the actual method source (`["payload"]`), merged with connector schema → `send_whatsapp` (to required), `send_github` (action+owner required), `send_email` (subject), `send_telegram` (chat_id)
- [x] Agent path: `connector-call` is EXTERNAL-tier; without approval → `approvalRequired` with real finalized details (`Connector: github · method: send · {"action":"create_issue",...,"title":"Ship it"}`); confirm(true) → runs; confirm(false) → declined; unknown connector → honest failure, never fabricated
- [x] Secrets masked in every API/UI response (raw keys never leak); registry rejects non-connector objects; `saveConnectorConfig` round-trips; test restores `settings.json` exactly

## What changed

```
server/src/connectors/            (new) ConnectorBase, ConnectorRegistry,
                                  whatsapp, github, email, telegram,
                                  toolBridge, index (wiring)
server/tests/connectorMocks.js    (new) labeled mock provider servers
server/test-connectors.js         (new) B56 acceptance suite (91 assertions)
server/index.js                   registerConnectors() at boot; /webhooks/connectors/*
                                  (raw body, before express.json, outside /api);
                                  /api/connectors (status, config, toggle, call)
server/src/services/ToolRegistry.js   +connector-call tool; toolsForIntent honors
                                      the intent allowlist (offer == runtime gate)
server/src/services/ToolRuntime.js    +connector-call schema/output/tier/engine/
                                      approval details (EXTERNAL for send, READ for
                                      receive/health)
server/package.json               npm test += test-connectors.js
server/test-tools.js, test-b49.js tool count 176 → 177
AGENT-CATALOG.md                  regenerated by the roster audit (177 tools)
src/components/ConnectorsScreen.jsx  (new) status/toggle/config/check/test-send UI
src/components/NavList.jsx        +Connectors (EXTENSIONS)
src/App.jsx                       +connectors route
```

## Not broken (verified by the full suite)

Existing permission profiles, RiskGuard, hooks, MCP server + allowlist, memory
schema, graph orchestrator, planner routing, and every prior B49–B55 suite
still pass (`npm test` exit 0). The `connector-call` tool is additive; no
existing tool or endpoint was removed or rewritten.
