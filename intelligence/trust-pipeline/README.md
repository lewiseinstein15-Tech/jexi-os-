# intelligence/trust-pipeline — Phase 9 Scope A

The trust pipeline is the single gate between the outside world and anything
a JEXI model reads. **Rule: any external data that reaches a model passes
through the broker. No raw fetches in agent logic.**

## Components

| File | Role |
|---|---|
| `broker.js` | Hardened broker: allowlist decision → https-only fetch (`redirect: 'manual'`, any 3xx refused) → hard timeout → capped body read → sanitized results/errors |
| `allowlist.js` | Registered-URL-only policy: exact-host + path-prefix matching, https, no userinfo, no non-standard ports. `resolveAllowed` (throws stable codes) and `checkAllowed` (verdict form) |
| `registered-urls.js` | The registry — single source of truth. Seeded with the Phase 9 OSINT layer endpoints; each entry carries `layer`, `provider`, `keyless`, `provenance` |
| `sanitize.js` | Streaming body cap (Content-Length pre-check + incremental read with cancel-on-breach) and error sanitization (stable codes, templated messages, no stacks/env) |

## Refusal codes (stable, model-visible)

`E_MALFORMED_URL`, `E_INSECURE_SCHEME`, `E_CREDENTIALS_IN_URL`,
`E_NONSTANDARD_PORT`, `E_UNREGISTERED_HOST`, `E_PATH_NOT_REGISTERED`,
`E_REDIRECT_REFUSED`, `E_TIMEOUT`, `E_TOO_LARGE`, `E_UPSTREAM_STATUS`,
`E_NETWORK`.

A refusal returns `{ ok: false, error: { code, message } }`. The templated
message is all a model ever sees; host/path specifics land only in the
broker's local audit log (`broker.status().audit`).

## Usage

```js
import { createBroker } from './intelligence/trust-pipeline/broker.js';

const broker = createBroker({ maxBytes: 1024 * 1024, timeoutMs: 15_000 });
const r = await broker.fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');
if (r.ok) {
  const data = r.json();        // sanitized, capped, registered
  r.warnings;                   // e.g. W_BODY_CAPPED if truncation occurred
} else {
  r.error.code;                 // 'E_UNREGISTERED_HOST' | 'E_TOO_LARGE' | ...
}
```

## Design provenance (research, clean-room)

Contracts studied at source level from `bilawalsidhu/gods-eye-view`
(37.8k★): registered-URL-only fetching, redirect rejection, private-IP
refusal, TLS pinning, response caps with stream cancel, sanitized errors
(SECURITY.md; `server/providers/common/http.js`). This implementation is an
independent clean-room build of those documented contracts — no GEV code
was copied (its repo license is `NOASSERTION`).

Scope B extends this with per-hop revalidation (dns-guard, TLS pinning) for
registrations that explicitly opt into redirect tolerance; the default
pipeline refuses all redirects.

## Honesty

- Default cap: 1 MiB per response; default wall-clock: 15 s (both enforced).
- The oversized-response probe drives the REAL cap reader with a real
  streaming body; only the network socket is a test double (labeled as such
  in the probe output). No external endpoint is used to fake a "too large"
  upstream.
