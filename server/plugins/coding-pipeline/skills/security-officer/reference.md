# Security Officer — Reference

Detailed security checklists and template. Loaded only when the security-officer skill executes.

## OWASP-class checklist

| Class | Ask | Severity if found |
|---|---|---|
| Injection | User input interpolated into SQL / shell / eval? | CRITICAL |
| XSS | User content rendered without escaping? | HIGH |
| Authn/Authz | Protected routes check identity? Role checks on every endpoint? | HIGH |
| Secrets | Hardcoded keys/tokens; secrets in logs; env exposure | CRITICAL |
| SSRF | Any URL fetch — is the target validated/allowlisted? | HIGH |
| Dependency | Known-vulnerable or unmaintained packages | MED |
| Data | Sensitive data in localStorage / plaintext at rest | MED |
| CORS/headers | Over-permissive origins, missing security headers | LOW/MED |

## Template

```markdown
## SECURITY REVIEW
### Assets & boundary
- <what is protected>, boundary at <x>

### Threats checked
- Injection: <ok / finding n>
- XSS: …
- SSRF: …

### Findings
1. [HIGH] `src/x.js:9` — <issue>

### Gate
CLEARED   (or: BLOCKED — fix findings 1, 2 before shipping)
```

## Severity grammar

- CRITICAL / HIGH → BLOCKED until fixed.
- MED → ship-blocking only if it touches the trust boundary.
- LOW / nits → note, never block alone.

## Always-check list

- [ ] No `process.env` keys printed to logs or sent to the client.
- [ ] Every outbound URL fetch has a host allowlist (SSRF).
- [ ] User-controlled strings never reach SQL / shell / `eval`.
- [ ] Auth-gated endpoints actually verify the caller.
