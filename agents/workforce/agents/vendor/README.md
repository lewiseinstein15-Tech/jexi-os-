# Vendored agent catalog

Source: [`msitarzewski/agency-agents`](https://github.com/msitarzewski/agency-agents)
License: MIT
Pinned commit: `87f8301cad3823a9a34d762036ae923a0eff306f`
Catalog file: `agency-agents.specs.json`
Regenerate: `node scripts/phase13-vendor-agency.mjs --src <path-to-checkout>`

## What is vendored, and what is not

The upstream repository ships each agent as a 10–30 KB Markdown document — 279
files, about 4.4 MB of prose. None of that is copied here.

The roster needs specs, not blobs: the runtime reads an agent's id, name,
division, role, capabilities, trust level, and origin. The prose body is the
authoring surface for the upstream project; it is not part of the roster
contract. So this directory vendors the projection — one JSON row per upstream
agent — and records the pinned commit so the prose can always be recovered:

    git clone https://github.com/msitarzewski/agency-agents
    git -C agency-agents checkout 87f8301cad3823a9a34d762036ae923a0eff306f

Copying the prose here would also contradict the roster contract. Every agent
under `workforce/` is checked by `scripts/lint-agent-baseline.sh`, which
requires the canonical "Prompt Defense Baseline" block verbatim. Upstream
documents do not carry it, and rewriting 279 upstream documents to add it would
mean shipping upstream prose that no longer matches upstream.

## Field derivation

For each upstream agent:

| Field | Source |
|---|---|
| `id` | upstream filename, minus `.md` |
| `name` | frontmatter `name` |
| `description` | frontmatter `description` |
| `role` | first `**Role**:` line in the body, else the description |
| `capabilities` | inferred from name/role/description by `workforce/agents/capabilities.js` |
| `division` | mapped from the upstream directory via `DIVISION_MAP` in the generator |
| `trustLevel` | `provisional` — vendored agents have no verified history |
| `sourceDivision` | upstream directory, preserved for provenance |
| `sourcePath` | upstream path within the checkout |

Upstream uses 18 divisions; JEXI uses a different 18. The mapping is explicit in
`scripts/phase13-vendor-agency.mjs` — e.g. upstream `paid-media` and `sales`
both land in JEXI `business`, because JEXI has no dedicated paid-media or sales
division.

## Determinism

Rows sort by id, so the same upstream checkout always produces a byte-identical
catalog. Verify with:

    node scripts/phase13-vendor-agency.mjs --src <path-to-checkout> --check

## Updating

To move to a newer upstream commit, check out the new commit, update
`UPSTREAM_COMMIT` in the generator, regenerate, and re-run `--check`. The
`--check` mode is the guard against silent drift in CI.
