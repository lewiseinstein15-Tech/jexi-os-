# FIXLOG-B65 — Email inbound: fetch the real received-email endpoint + response shape

**Status:** implemented, tested (133/133), pushed.

## The bug (proven by the first verified live delivery)

B64 fixed webhook verification, and the first real Resend delivery landed —
but the parsed inbound event had `text: null, html: null`: the body fetch
was silently failing. Checking against Resend's docs
(`api-reference/emails/retrieve-received-email`) exposed two B61 assumptions
that never matched the real API:

1. **Wrong endpoint.** The Received-emails endpoint is
   `GET /emails/receiving/:email_id`. B61 used `GET /emails/:email_id` —
   that's the **sent**-email endpoint — so every received-id fetch returned
   404 and `receive()` (which swallows fetch errors to keep the
   metadata-only event) recorded `text: null`.
2. **Wrong response shape.** The real response carries `text` and `html` at
   **top level** and `headers` as an **object** with lowercase keys
   (`{ "message-id": "…", references: "…" }`) — not nested under `body`, and
   not an array of `{name, value}`. So even a successful fetch would have
   missed the body and the Message-ID / References threading headers.

## What changed (`server/src/connectors/email.js` + mocks)

- `fetchEmail()` → `GET {baseUrl}/emails/receiving/{email_id}` (B65).
- `normalizeInboundEvent()` reads `text`/`html` from top level first
  (nested `body` tolerated for back-compat) and `headerValue()` now handles
  both the object form (real) and the array form (legacy).
- `reply()` quotes the original from top-level `text`/`html`, so quoted
  replies work on the real shape.
- `server/tests/connectorMocks.js` — the received-email mock now serves the
  REAL route + shape (`/emails/receiving/:id`, top-level `text`/`html`,
  object `headers`), so the existing inbound/reply tests are a live
  regression test: if the connector ever regresses to the wrong URL or shape,
  `inboundEvents[0].text === 'Hello JEXI, can you reply?'` fails.
- `server/CONNECTORS.md` — endpoint documented as `/emails/receiving/{id}`.

## Verification

- Connector + full suites: **133/133 PASS**.
- Live proof: replay/email once the build is deployed — the inbound event
  must now carry the real body text, and `reply()` must send a threaded
  `Re:` reply back to the sender.
