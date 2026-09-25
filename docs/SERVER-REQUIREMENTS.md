# Server Requirements

Minimum environment for running the JEXI server (`server/`) — the boot unit
behind the web console, the API surface, and the Phase 31 wiring seam. The
authoritative source for the runtime floor is `server/package.json`
(`engines.node`); this document explains it and adds the resource minimums.

## Node.js floor: >= 22.5

The server requires **Node >= 22.5**. This floor is declared twice and
enforced twice:

- `server/package.json` → `"engines": { "node": ">=22.5" }` (declared floor).
- The W36 boot gate in `server/src/wiring/phase31-bootstrap.js`
  (`NODE_FLOOR = '22.5'`) — a hard gate that runs before any other wiring and
  **refuses to boot** with a clear error on any older runtime. There is no
  fallback and no override flag.

The floor exists because the server's memory backend uses the built-in
`node:sqlite` module, which the W36 error message names explicitly. Phase 31
verification was performed on Node v24.21.0, which satisfies the floor.

## CI / image runtime: Node 24.x (cleanup v2, 2026-09)

The declared **floor** stays `>= 22.5` (it mirrors the W36 boot gate and
`node:sqlite`'s landing version), but the pinned **runtime** used by CI and
the shipped images is now Node 24: `node-version: 24` in every workflow
(`ci.yml`, `validate-divisions.yml`, `apk.yml`, `deploy.yml`;
`xbow-benchmark.yml` already pinned 24) and `FROM node:24-slim` in both
`Dockerfile` and `Dockerfile.slim`. Bumped from 22 by the consolidated
cleanup v2 pass — see `docs/CONSOLIDATED-CLEANUP-v2-2026-09.md`. The root
`package.json` now also declares the same floor (`engines.node >= 22.5`),
so both install roots state the identical minimum.

## Minimum server requirements

| Resource | Minimum | Comfortable | Measured reference |
|----------|---------|-------------|--------------------|
| RAM      | 2 GB free for the server process | 4 GB total host memory | ~363 MB resident (VmRSS 371,908 KB) after boot with `/api/health` returning 200, sampled twice 2 s apart on a 4 GB host |
| Disk     | 2 GB free for checkout + both `npm ci` installs | 3 GB free | 1.1 GB working tree including `server/node_modules` (339 MB) and root `node_modules` (700 MB) |
| Network  | localhost only (loopback `127.0.0.1`) to boot and operate the console | Outbound HTTPS for provider-backed features | Local-only boot verified on loopback; no inbound exposure required |

Notes on the numbers above: they were measured on the Phase 31 verification
sandbox, not estimated. RAM figures are resident memory — the Node/V8 virtual
address space peaks near 10 GB by design (reservation, not allocation), so
`VmPeak` is not the planning number; resident RSS is. Disk is dominated by the
two dependency trees, not by source. The reference host boots the server
comfortably within the "Minimum" column.

## Network posture

JEXI is local-first. Booting the server and using the console require only
loopback connectivity: the console on `:3000` and the brain on `:3002` (per
`npm run dev:full`), with `/api/health` as the local liveness probe. Outbound
network is needed only for opt-in, provider-backed features: LLM providers
(OpenAI-compatible endpoints), web search engines, MCP servers that reach
remote hosts, and git operations against remotes. With no provider configured,
the deterministic in-process agent answers locally and no outbound network is
used.

## Installation

Install both dependency trees before boot (see README "Quick Start"):

```bash
npm ci                      # repo root
npm --prefix server ci      # server/
```

On the `phase-31-wiring` verification branch these two installs were already
executed during Phase 31 Scope 1 environment bring-up and are not re-run by
the boot path — the Phase 31 bootstrap (`server/src/wiring/phase31-bootstrap.js`)
performs no package installation; it requires both `node_modules` trees to be
present. The full regression chain is run chunked via
`node scripts/run-tests-chunked.js` (state-persisting, resumable).

## docs/README-INDEX.md maintenance status (Phase 31 Scope 8, S8.4)

`docs/README-INDEX.md` (the every-file-under-docs index) is **hand-maintained
as of Phase 31 Scope 8**: no generator or runner script for it exists in this
repository — verified by scanning `scripts/` and `server/scripts/` for any
reference to `README-INDEX` (zero hits; the file's own header credits a Phase 30
Scope H generation whose tooling did not ship in the tree). Consequently there
is no slice-based runner to correct (the Phase 30 H-fix-2 lesson: a
partial/slice-based generation silently omitted docs). Rule for future edits:
any regeneration must be a **full scan** — every file under `docs/` linked
exactly once — or the index will drift from the directory it claims to cover.
