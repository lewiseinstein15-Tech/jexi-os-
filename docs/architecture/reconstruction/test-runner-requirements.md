# Test Runner Requirements (JEXI OS — Phase 3 Step 4 / C3)

Authoritative reference for what a JEXI test runner needs. Applies to CI
(.github/workflows/ci.yml), an OpenHands sandbox, and an operator shell.

## 1. Environment variables required

| Variable | Required? | Purpose | Keyless default |
|----------|-----------|---------|-----------------|
| `GITHUB_TOKEN` | optional | GitHub connector / SessionKeys resolveToken tests | unset — tests assert the `needInfo`/parking path |
| `PROVIDER_KEYS_PRESENT` | optional | C2 keyless-skip switch; `1`/`true`/`yes` enables live lanes absent keys otherwise skip | unset (skip live lane) |
| `OLLAMA_BASE_URL` | optional | local-LLM backend tests (OfflineAgent) | unset (reports configured:false) |
| Any `*_API_KEY` / `*_TOKEN` | optional | live provider round-trips (deepseek, exa, perplexity, …) | unset (keyless tests assert degraded path) |

The `server` suite must pass with **all of the above unset** (keyless runner).

## 2. Packages required

From `server/package.json`:

- **Runtime deps** — installed via `npm install` (both lock and node_modules).
- **Dev deps for UI tests (C1 react gap fix):**
  - `react@^18.3.1`, `react-dom@^18.3.1`, `lucide-react@^0.400.0`
  - Required by `test-b197.js`, `test-b200.js`, `test-rich-render.js`,
    `test-setup-wizard.js` (render real React trees).
  - `server/package-lock.json` MUST stay in sync with `server/package.json`
    (CI runs `npm ci`, which hard-fails on drift — EUSAGE).
- **Root deps** — CI runs a second `npm ci` at repo root for the frontend
  build (`npm run build`) and the `rich-render` test's react-markdown/esbuild.
- No other exotic packages.

## 3. Keyless-safe tests (run with NO provider keys; never fail)

These suites are designed to pass without any API key:

| Test | Why it is keyless-safe |
|------|------------------------|
| `test-web-search.js` | seam tests inject deps; keyed providers assert the *unconfigured* path |
| `test-reliability.js` | offline/in-process failure injection |
| `test-builder.js` | BuilderAgent with mocked `generateContent`; KEYLESS GUARD clears GITHUB_TOKEN |
| `test-hermes-full.js` | in-memory seams / mock generate; asserts the honest-degraded path |
| `test-dsh-batch7.js` | external-CLI dialects use fake-binary fallback; mock URLs only |
| AGI `test-capability-router.js` | capability routing with keyless fallback honest failures |
| AGI `test-worker-registry.js` | deterministic local registry tests |
| AGI `test-ollama-provider.js` | probes "no local backend" honestly; no key needed |
| AGI `test-jexi-kernel.js` | kernel health on a keyless boot |
| `npm test` head suites | all same pattern — see per-file banner |

## 4. Network-required tests (SKIP when keyless)

| Test | What needs network/keys | Skip mechanism |
|------|------------------------|----------------|
| AGI `test-director-mcp.js` (live lane) | live weather MCP round-trip via router | C2: `PROVIDER_KEYS_PRESENT` falsey → `t.skip('skipped: no provider keys in env')`; plus existing live-probe `t.skip` |
| AGI `test-mcp-gateway.js` invoke tests | real MCP gateway invoke | clean per-case skip when unconfigured |
| Tests calling `fetch()` against real SaaS endpoints | live API | excluded from keyless runs |

## 5. Runner checklist

```bash
# Fresh keyless run (matches a clean CI checkout):
cd server && npm ci          # hard-fails if lock drifted from package.json
npm test                     # must report 0 failures with no keys set
npm run lint                 # error-level rules only (no-unused catches FPs)
```

Then optionally re-run with real keys:
`PROVIDER_KEYS_PRESENT=1 DEEPSEEK_API_KEY=... EXA_API_KEY=... npm test`
to enable the live lanes skipped above.