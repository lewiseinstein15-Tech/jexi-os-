# FIXLOG-B63 — WhatsApp permanent-chat hardening (24h-window template fallback)

**Status:** implemented, tested (connector suite 127/127), pushed.

## Why

The WhatsApp number is being moved out of test mode to make the setup
permanent. That removes the allowlist and the self-account quirk — but Meta
replaces them with a new rule that would have broken "anyone can chat":

> Outside the 24-hour customer-service window (after the user's last message),
> a business **cannot send free-form text** — only approved **templates** are
> allowed.

So the moment the number goes live, an inbound message at 2 AM would trigger
JEXI's reply loop, the free-form reply would be rejected by Meta with
`(#131047) Re-engagement message` / `(#132000)`, and the sender would get
silence. Same for the app's "message anyone" compose box.

## What changed

- **`server/src/connectors/whatsapp.js`**
  - `send()` now catches Meta rejections that mean "free-form text is not
    allowed right now" (error codes `131026 / 131030 / 131047 / 131048 /
    132000`, read from the raw provider payload or the `(#code)` in the
    message) and retries **once** as the approved template via the new
    `sendTemplateFallback()`.
  - Fallback defaults to `hello_world` (Meta's built-in template, body
    `"Hello {{1}}"`, which every WABA ships with) with the body parameter
    filled; override with `WHATSAPP_TEMPLATE_NAME` (+ `WHATSAPP_TEMPLATE_LANG`,
    default `en_US`) to use a custom approved template.
  - The successful fallback returns `fallback: 'template'` alongside the
    wamid, so the inbox/UI can see exactly how the reply went out.
  - The auto-reply loop and the app's "message anyone" both go through
    `send()`, so they inherit this with no further changes.
- **`server/tests/connectorMocks.js`** — `window-*` token: free-form text →
  HTTP 400 `#131047`; template → HTTP 200 wamid (exercises the fallback path).
- **`server/test-connectors.js`** — outside-window text send auto-falls back
  to the template (asserts `fallback: 'template'` + template wamid); explicit
  template sends pass through unchanged; custom `WHATSAPP_TEMPLATE_NAME` is
  honored.
- **`server/CONNECTORS.md`** — documents `WHATSAPP_TEMPLATE_NAME` /
  `WHATSAPP_TEMPLATE_LANG` and the 24/7 behavior.

## Live verification

- Connector suite: **127/127 PASS** (3 new B63 assertions).
- Real-provider verification is blocked on the number leaving test mode (that
  is the current task); the fallback only fires against a live Meta rejection,
  and the mock exercises the exact `#131047` payload Meta sends.

## To activate the permanent setup (Meta dashboard — one-time)

1. **Payment method** — Business Manager → your WhatsApp Business Account →
   Billing → add a card (only pay per conversation after Meta's free tier).
2. **Business verification** — Business Manager → Settings → Security center →
   Business verification (submit business/individual details + document).
3. **Verify the number** — WhatsApp → API Setup → the number now shows
   **Verify** → enter the SMS code Meta sends → set a display name.
4. Once live: the allowlist disappears, your own number can message the
   business number, and the 24h window is handled automatically by B63.
