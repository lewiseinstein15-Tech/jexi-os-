# FIXLOG-B64 — Email inbound: Svix verification corrected (Ed25519 → HMAC-SHA256)

**Status:** implemented, tested (133/133), pushed.

## The bug (found by the first real Resend delivery)

B61 shipped the email inbound webhook verifier as **Ed25519**: derive a public
key from the `whsec_` secret (PKCS8-DER trick) and verify
`svix-id.svix-timestamp.rawBody` with `crypto.verify(null, …, 'Ed25519')`. It
passed local tests because the tests **signed with the same Ed25519 scheme**
— self-consistent, but wrong for Resend.

The first real delivery proved it: the user emailed
`jexi-test@talowoi.resend.app` ("Hello jexi"), Resend fired the
`email.received` webhook, and JEXI answered **HTTP 403 — "Webhook signature
verification failed"** on every attempt (recorded 3× in the inbound log:
10:24:57 / 10:25:01 / 10:27:09 UTC, matching Resend's retry schedule).

The docs are unambiguous (checked during the fix):

- **Svix manual verification** (docs.svix.com → verifying-payloads/how-manual):
  "Svix uses an **HMAC with SHA-256** to sign its webhooks… HMAC the
  signed_content using the base64 portion of your signing secret as the key."
- **Resend** delivers through Svix with the standard `svix-*` headers.

So the correct scheme is:

```
signed_content = `${svix-id}.${svix-timestamp}.${rawBody}`
key            = base64-decode(secret after `whsec_`)
expected       = base64(HMAC-SHA256(key, signed_content))
```

plus a timestamp-tolerance check (Svix default 5 minutes) against replay.

## What changed

- **`server/src/connectors/email.js`**
  - `verifySvixSignature()` rewritten to the HMAC-SHA256 scheme above with a
    configurable `toleranceSeconds` (default 300).
  - New `verifySvixSignatureDetailed()` → `{ ok, reason }` so every rejection
    names the cause (missing header / timestamp out of tolerance / no
    matching signature / bad secret).
  - New connector method `verifyWebhookSignatureResult()` exposing that reason.
- **`server/src/connectors/index.js`** — email webhook rejections now record
  and return the exact reason (e.g. "…— no svix v1 signature matched the
  HMAC-SHA256 expected value") instead of a generic message, so any future
  failure is diagnosable straight from `/api/connectors/email/inbound`.
- **`server/test-connectors.js`** — rewrote the Svix tests to the real scheme,
  including a regression test against **Svix's own published example
  signature** (secret `whsec_plJ3nmyCDGBKInavdOK15jsl`, payload
  `{"event_type":"ping",…}`, `v1,rAvfW3dJ/…` — the exact values from Svix's
  docs), plus fresh-timestamp round-trips, tamper/bad-signature/wrong-version
  rejections, the replay guard (old timestamp), and reason surfacing.
- **`FIXLOG-B61.md`** — correction note appended (the "verified with real
  Ed25519 round-trips" claim there was self-consistent but never matched
  Resend; the B61 build must not be trusted for webhook verification).

## Verification

- Connector suite + full suite: **133/133 PASS**.
- The real proof is the next live delivery: once deployed, Replaying the
  "Hello jexi" event (or emailing the address again) must return 200 and a
  parsed inbound event. No further user-side secret changes should be needed —
  the secret on Render is correct; the verifier was the bug.
