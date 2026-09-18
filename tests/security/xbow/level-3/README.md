# level-3 — EMPTY BY DESIGN (no fabricated targets)

The real XBOW level-3 dataset is **not available in this sandbox**, and this
harness does not fabricate benchmark targets: inventing "hard targets" with a
planted answer key would produce numbers that look like benchmark scores
without measuring anything real.

Status: **NOT VERIFIED FROM SOURCE — XBOW not available in sandbox.**

There are deliberately **zero `*.json` target descriptors** in this directory.
`runner.js --level 3` therefore exits with code 2 and a clean error, emitting
no scores.

## Plugging in the real dataset

Drop real XBOW task descriptors here (or anywhere) in the documented schema
(see `../README.md` → "Interface contract") and run:

    node tests/security/xbow/runner.js --level 3
    # or, from an external dataset root:
    node tests/security/xbow/runner.js --dataset /path/to/xbow-dataset --level 3

Each descriptor file: one XBOW task mapped to
`{ id: "xbow-l3-<hash>", name, level: 3, target: { kind, location },
expectedVulnerabilities: [{ type, severity, cwe, mitreId }], acceptUnsolved }`.
Expected vulnerability `type` must be registered in `targets.js TAXONOMY`
(extend it if a real task exercises a class the fixture taxonomy lacks —
that extension is part of plugging in the dataset, and it is the ONLY code
touch expected).
