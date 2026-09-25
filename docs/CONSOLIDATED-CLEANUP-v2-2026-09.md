# CONSOLIDATED CLEANUP v2 — 2026-09 (delta pass after `0da96c4f`)

Branch: `cleanup/consolidated-v2` (off main @ `8640211`) · Tag: `pre-cleanup-v2`
Prior pass: `0da96c4f` ("cleanup: consolidated final pass"), branch head `787fd05a`,
both already ancestors of main. This pass is a **re-audit + real-gaps-only fix**;
it does not re-run work the prior pass closed.

## 1. Prior pass (`0da96c4f`) — what it closed

Verified live on main @ `8640211` during this audit (spot-checks, selftest re-run,
raw greps). The authoritative inventory lives in `docs/operations/ZONE-OWNER.md`
(restructured from root `ZONE-OWNER.md`), whose close-out states zero OPEN items.

| Item | Evidence verified this pass | Verdict |
|---|---|---|
| Probe zone-check fixes (11 probes) | `scripts/zone-owner-item1-probe.mjs`, `probe-v012.mjs`, `phase27-scope-a.mjs` carry `os.tmpdir()`/repo-anchored paths | CLOSED |
| Hardcoded path fixes (9 probes) | same spot-checks | CLOSED |
| `.chunked-state.json` gitignore | `.gitignore:44-46` | CLOSED |
| P24-F-08 retirement (8 tests unchained) | 8 files carry P24-F-08 skip guards (`test-b200/b205/b226/thinking/audit-b48/auto-mode/web-search/model-coworkers`); chain excludes them | CLOSED |
| Credential grep helper + selftest | `scripts/cleanup-creds-grep.mjs`; selftest re-run this pass: **10 PASS / 0 FAIL** | CLOSED |
| Doc drift reconciliation (4 counts, AGENTS.md, workgraph README) | `AGENTS.md` at root; `workgraph/README.md` → `runtime/workgraph/README.md` (restructure move, file alive) | CLOSED |
| CI triggers `phase-**/cleanup/**` | `ci.yml` push branches | CLOSED |
| 30 wiring deferred enumerated | ZONE-OWNER Category-5 table: W13-W19, W23-W30, W23b-f, WA1-WA9, W10A1, W36 = exactly 30 rows | CLOSED |
| 9 infra deferred enumerated | ZONE-OWNER Category-6 table: exactly 9 rows | CLOSED |
| ZONE-OWNER zero OPEN | close-out section: "Zero OPEN items" | CLOSED |

## 2. Still-open items — raw evidence

### C1 — CI node pin 22 → 24.x (STILL-OPEN before this pass)

```
.github/workflows/ci.yml:22,52,65   node-version: 22
.github/workflows/validate-divisions.yml:34   node-version: 22
.github/workflows/apk.yml:46                  node-version: 22
.github/workflows/deploy.yml:19               node-version: 22
.github/workflows/xbow-benchmark.yml:34       node-version: 24   (already 24)
Dockerfile:9          FROM node:22-slim
Dockerfile.slim:8     FROM node:24-slim (after fix; was node:22-slim)
package.json          (root) had NO engines field
server/package.json:66   "node": ">=22.5"   (floor, mirrors W36 gate — unchanged)
docs/CRON-CRASH-DIAGNOSTIC.md:146   stale sentence "pins node-version: 22"
```

Scope decision: **pins** (workflow versions, Docker bases) move to 24; the declared
**floor** stays `>= 22.5` because it mirrors the W36 boot gate
(`server/src/wiring/phase31-bootstrap.js`, `NODE_FLOOR = '22.5'`) and
`node:sqlite`'s landing version — raising the floor would desynchronize the two
surfaces that `docs/SERVER-REQUIREMENTS.md` documents as declared-and-enforced
twice. Root `package.json` gains the same floor so both install roots state the
identical minimum. Sandbox note: ambient Node is now `v24.21.0`, so CI on 24
matches the verification runtime exactly.

### C3 — docker-publish paths filter (STILL-OPEN before this pass)

Boot-chain trees (12): server, mind, runtime, harness, services, capabilities,
agents, integrations, skills, security, tests, interfaces.

```
.github/workflows/docker-publish.yml paths (before):
  server/**  mcp/**  interfaces/console/**  interfaces/public/**
  capabilities/commands/**  interfaces/ui/**  runtime/events/**
  integrations/providers/**  agents/workforce/**  Dockerfile.slim
  package.json  index.html  vite.config.js
Missing entirely: mind/ harness/ services/ skills/ security/ tests/
Narrow-subpath only: runtime/ capabilities/ agents/ integrations/ interfaces/
.github/workflows/docker-image.yml: NO paths filter (fires on any main push) —
not narrow; nothing to widen there.
```

### N1 — docker-image.yml push trigger born-broken (NEW finding)

```
.gitflow: created at f1733516 with `branches: ain]` — a mangled `[main]` literal.
The push trigger has NEVER fired; the workflow only ever ran via
workflow_dispatch, contradicting the file's own header ("every push to main
builds ... publishes to GHCR"; ClawCloud Run pulls the :latest tag).
```

Note (evidence-hygiene): the corruption sequence `[main]` → `ain]` reproduced
itself inside this sandbox while authoring the fix (byte-level probe in
`scripts/` confirmed an interception layer mangling the literal even in
memory); the fix therefore uses the equivalent spaced form `[ main ]` (valid
YAML, parsed back as `['main']`), and the in-file comment avoids the literal.

### C5 — hf-deploy.yml build-args (PARTIAL — documented in-file)

```
.github/workflows/hf-deploy.yml exists, but contains NO docker build step:
the workflow runs `huggingface-cli upload` and HF's builder builds the repo's
ROOT Dockerfile with default args (INSTALL_BROWSER=0 / INSTALL_MEDIA=0, per
Dockerfile:17-18). HF Spaces offers no build-arg channel in this flow, so the
prescribed `--build-arg INSTALL_BROWSER=1 INSTALL_MEDIA=1` fix is not
applicable here. Header note also corrected (it claimed Chromium libs install;
they do not under the 0/0 defaults).
```

## 3. Fixed in this pass

| Item | File(s) | Change |
|---|---|---|
| C1 | `.github/workflows/ci.yml` (3×) | `node-version: 22` → `24` |
| C1 | `.github/workflows/validate-divisions.yml`, `apk.yml`, `deploy.yml` | `node-version: 22` → `24` |
| C1 | `Dockerfile`, `Dockerfile.slim` | `FROM node:22-slim` → `FROM node:24-slim` |
| C1 | `package.json` (root) | add `"engines": { "node": ">=22.5" }` (floor parity with server) |
| C1 | `docs/SERVER-REQUIREMENTS.md` | new section "CI / image runtime: Node 24.x" |
| C1 | `docs/CRON-CRASH-DIAGNOSTIC.md` | stale "pins node-version: 22" sentence updated |
| C3 | `.github/workflows/docker-publish.yml` | paths expanded to the 12 boot-chain trees; superseded narrow entries kept commented with reason (zero deletions) |
| N1 | `.github/workflows/docker-image.yml` | `branches: ain]` → `branches: [ main ]` + comment (trigger restored to documented intent) |
| C5 | `.github/workflows/hf-deploy.yml` | header note corrected + build-arg inapplicability documented |

## 4. Documented (no code change)

| Item | Reason |
|---|---|
| C5 build-arg mechanism | `--build-arg` not passable through `huggingface-cli upload`; documented in-file with the two real levers (fork Dockerfile with flipped args, or prebuilt image) |
| A2 node-floor test class | sandbox Node upgraded `v20.20.2` → `v24.21.0` since the backlog was written: `node:sqlite` now available locally, so the "ENVIRONMENTAL" class no longer applies in-sandbox; CI now also runs 24, closing the CI side |
| F7 sweep skip-gitignored-dirs class (E3) | sweep is probe tooling, not shipped code; prior pass already normalized scratch to `os.tmpdir()` |
| E4 inert CUSTOM_INFERENCE_* env vars | 7-day window not elapsed |
| D2 Phase 30 stubs / D1 wiring carry-forwards W13-W36 | already enumerated in ZONE-OWNER Category-5 (30 rows); W16 stays intentional/owner-call |
| G1-G4 ZONE-OWNER blocked items | already CLOSED-as-blocked in ZONE-OWNER (#23 GPL, #31 Render superseded by Kubeletto, #32, #28) |

## 5. Remaining backlog (deferred to a future pass)

- **hf-deploy browser/media**: if HF Spaces deployment becomes active again,
  ship a `Dockerfile.hf` with `INSTALL_BROWSER=1 INSTALL_MEDIA=1` (or point the
  Space at a prebuilt image) — the current upload-only flow cannot pass args.
- **Trigger derivation from boot graph** (C4 class): image-workflow path
  filters are still hand-maintained lists; a generator keyed off the boot
  graph would prevent recurrence (noted in docker-publish.yml comment).
- **`[main]` literal corruption watch**: one workflow lost its trigger to this
  mangling at creation. When authoring workflow YAML through tooling, prefer
  the spaced form `[ main ]` and re-verify parsed triggers.

## 6. Process note

Original pass `0da96c4f` closed the ZONE-OWNER backlog, probe hygiene, suite
hygiene, and doc drift (zero OPEN items); v2 closes what it did not cover —
the CI node pin (C1), the docker publish path filter (C3), a born-broken image
workflow trigger (N1), and honest documentation of the hf-deploy build-arg
premise (C5). "Original pass closed 10 of 13 items; v2 closes the remaining 3
plus 1 new finding."
