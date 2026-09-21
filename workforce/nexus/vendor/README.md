# Vendored NEXUS strategy layer

Source: [`msitarzewski/agency-agents`](https://github.com/msitarzewski/agency-agents)
License: MIT
Pinned commit: `87f8301cad3823a9a34d762036ae923a0eff306f`
Projection file: `agency-agents.strategies.json`
Regenerate: `node scripts/phase13-vendor-nexus.mjs --src <path-to-checkout>`

## What is vendored, and what is not

The upstream strategy tree is doctrine, not installable agents:

    strategy/nexus-strategy.md                          1110 lines of prose
    strategy/EXECUTIVE-BRIEF.md
    strategy/QUICKSTART.md
    strategy/coordination/agent-activation-prompts.md
    strategy/coordination/handoff-templates.md
    strategy/playbooks/phase-0-discovery.md … phase-6-operate.md
    strategy/runbooks/scenario-*.md
    strategy/runbooks.json                              machine-readable

None of the prose is copied here. The same rule as Scope A's roster applies:
`scripts/lint-agent-baseline.sh` governs every `workforce/**.md` and requires
the canonical "Prompt Defense Baseline" block verbatim, which upstream
documents do not carry. Copying upstream prose would also pin a snapshot that
drifts from upstream on the next read.

What is vendored is the **projection**: the routing decisions the prose encodes,
as rows. The prose stays recoverable at the pinned commit:

    git clone https://github.com/msitarzewski/agency-agents
    git -C agency-agents checkout 87f8301cad3823a9a34d762036ae923a0eff306f

## What is projected, and from where

| Scope | Rows | Projected from |
|---|---|---|
| `phase` | 7 | `nexus-strategy.md` per-phase "Active Agents" tables (phases 0,1,2,4,5,6) |
| `phase` | (1) | phase 3 has no Active Agents table — composed from the 6.2 task matrix |
| `task` | 13 | `nexus-strategy.md` §6.2 "Agent Assignment by Task Type" |
| `scenario` | 4 | `strategy/runbooks.json` |

Each row carries the upstream `doc` path it came from, so a row can always be
traced back to the sentence that produced it. Phase rows also carry
`playbookMeta` — duration, agent count, and gate keeper read from the matching
playbook header.

## Agent references are names, not roster ids

A row's `candidates[]` holds the upstream display names (`"Frontend Developer"`)
or, for scenario rows, the upstream slugs (`"engineering-frontend-developer"`).
They are **not** resolved here. Resolving a reference to a roster agent is a
runtime act: it consults Scope A's roster, so the projection stays a faithful
reading of upstream rather than a snapshot of whichever roster happened to be
loaded when the file was generated.

Resolution is deterministic (`workforce/nexus/orchestration.js`): exact id, then
exact name (case-insensitive), then name-with-spaces-as-dashes. An ambiguous or
unresolvable reference is a refusal, never a guess.

## What JEXI adds

Two fields do not exist upstream:

- `kind` — the canonical routing token for the strategy (`build`, `discovery`,
  `incident-response`, …).
- `aliases[]` — additional tokens that also select the strategy.

Upstream has no routing vocabulary; it has headings and scenario slugs. `kind`
and `aliases` are the JEXI layer that lets `nexus.route(intent)` match an intent
to a strategy with no hidden default. They are declared here, in the artifact,
rather than emerging from match order.

The generator also computes `aliasCollisions` — every token claimed by more than
one strategy — and writes it into the artifact. It is empty at this commit. If a
future upstream revision introduces a collision, the generator reports it and
the collision is visible in the file rather than silently resolved by sort
order.

## Determinism

Rows sort by id; `aliases` sort within a row. Verify with:

    node scripts/phase13-vendor-nexus.mjs --src <path-to-checkout> --check

## Updating

To move to a newer upstream commit, check out the new commit, update
`UPSTREAM_COMMIT` in the generator, regenerate, and re-run `--check`. The
generator fails loudly on drift rather than emitting a partially-updated file.
