# JEXI OS — SSRF Shield (Phase 9 Scope B)

Defense-in-depth for every outbound fetch made by the OS. Complements the
trust pipeline's allowlist (`intelligence/trust-pipeline/`, Scope A): the
allowlist decides WHICH URLs may be fetched; the shield decides HOW a fetch
may touch the network at the IP/TLS layer.

## Modules

| File | Responsibility |
|------|----------------|
| `dns-guard.js` | IP classification (`isPublicIP`, `classifyIp`) + verified DNS resolution (`resolveAndVerify`): A+AAAA resolved in ONE round, refused if ANY address is non-public, verified set returned for reuse (no re-resolve — TOCTOU/rebinding defense). Optional `prior` set: divergence ⇒ `E_DNS_REBINDING_REFUSED`. |
| `tls-pin.js` | Post-connect certificate verification: validity window, hostname coverage (SAN preferred, wildcard rules), optional SHA-256 fingerprint pins per hostname. |
| `ssrf.js` | `checkRedirect(chain)` (per-hop revalidation), `pinnedFetch(url, opts)` (resolve-once → connect-to-verified-IP → verify cert → refuse/follow redirects), `createPinnedFetchImpl()` (fetch-compatible adapter that IS the trust pipeline broker's default transport). |

## Refused by default (stable codes)

- Private resolution: RFC1918 (`E_PRIVATE_IP_REFUSED`), loopback
  (`E_LOOPBACK_REFUSED`), link-local (`E_LINK_LOCAL_REFUSED`), multicast
  (`E_MULTICAST_REFUSED`), cloud metadata endpoints 169.254.169.254 /
  169.254.170.2 / fd00:ec2::254 (`E_METADATA_ENDPOINT_REFUSED`), CGNAT /
  TEST-NET / benchmark / reserved / transition prefixes
  (`E_NON_PUBLIC_IP_REFUSED`). IPv6 equivalents included: `::1`,
  `fc00::/7`, `fe80::/10`, `ff00::/8`, IPv4-mapped (`::ffff:0:0/96`),
  NAT64 (`64:ff9b::/96`).
- Redirects: refused at the broker (`redirect:'manual'` semantics). When
  following is explicitly enabled, every hop re-classifies the target —
  non-public ⇒ `E_REDIRECT_TO_PRIVATE_IP`, https→http ⇒
  `E_REDIRECT_SCHEME_DOWNGRADE`, revisited URL ⇒ `E_REDIRECT_LOOP`.
- DNS: no records ⇒ `E_DNS_NO_ADDRESS`; resolution diverging from the
  verified set ⇒ `E_DNS_REBINDING_REFUSED`.
- TLS: missing cert ⇒ `E_TLS_NO_CERT`; expired ⇒ `E_CERT_EXPIRED`;
  not-yet-valid ⇒ `E_CERT_NOT_YET_VALID`; hostname not covered ⇒
  `E_CERT_HOSTNAME_MISMATCH`; fingerprint not pinned ⇒ `E_TLS_PIN_MISMATCH`.
- Tripwire: the socket may only resolve the pinned hostname ⇒
  `E_PINNED_HOST_MISMATCH`.

## Connection policy

One DNS round per request → every resolved address classified → connection
dialed to a VERIFIED address via a custom `lookup` (no re-resolve) → original
hostname kept for SNI + certificate identity → fresh non-pooled connection
per request (a pooled socket would bypass the per-request verified-IP
guarantee) → `accept-encoding: identity` (the shield reads raw bytes; it
never negotiates encodings it cannot verify or cap).

## Test seams (labeled doubles only)

`resolver` (DNS), `transport` (socket engine) and `label` are injectable for
probes. Production paths use the defaults (node dns + node http/https).
Probe doubles are labeled in output and in `meta.label` — nothing is
simulated silently. Scope-B probe: `scripts/phase9-b-probe.mjs` (P0–P10,
real DNS/TLS/HTTP where the sandbox permits; vectors that cannot be
reproduced locally — DNS answers, public-IP first hops — use labeled doubles
and say so).

## Clean-room disclosure

Contracts modeled on the hardened-proxy doctrine (registered-URL-only,
redirect refusal, private/metadata refusal, response caps, sanitized errors)
as documented in bilawalsidhu/gods-eye-view SECURITY.md and
`server/providers/common/http.js`. Implementation is original.
