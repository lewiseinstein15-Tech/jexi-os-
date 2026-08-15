# Security Officer — Reference

## OWASP-class checklist (client + simple server code)
- [ ] **Injection** — user input concatenated into SQL/HTML/URLs without escaping.
- [ ] **XSS** — `innerHTML`/`eval`/`document.write` fed by user input.
- [ ] **Secrets** — API keys, tokens, passwords hardcoded in source.
- [ ] **Insecure transport** — plain `http://` for anything sensitive.
- [ ] **Auth assumptions** — "admin" flags set from client input; no validation on the server.
- [ ] **Input validation** — missing bounds/type checks that could crash or overflow.

## Secrets patterns (flag any of these)
`api[_-]?key`, `token`, `secret`, `password`, `bearer`, `sk-[a-zA-Z0-9]` (OpenAI), `AIza` (Google), `gh[pousr]_` (GitHub), `xai-`, `gsk_` (Groq).

## Verdict format
```
## SECURITY REVIEW
- [BLOCKER] app.js:7 — hardcoded API key visible in source (sk-...).
- [WARN] app.js:21 — innerHTML with user input (XSS risk).

Verdict: BLOCKED
```
or
```
## SECURITY REVIEW
- No secrets, no injection surface, inputs validated. Transport is local.

Verdict: CLEARED
```

## Policy
- A single hardcoded secret or injectable sink = BLOCKED. No exceptions.
- The verdict must reference the actual code shown; never invent findings.
