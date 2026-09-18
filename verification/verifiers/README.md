# VERIFIERS — independent exploit verification (Phase 8 Scope G)

**Doctrine: "No exploit, no report."** Every vulnerability finding must be
proven exploitable by THIS layer before it reaches any report. The verifier
does not trust the exploit agent's claim of success — it re-executes the
exploit itself and observes the response.

## Modules

| file                 | role |
|----------------------|------|
| `exploit.verifier.js`| re-execution engine: reads the finding from the knowledge graph, enforces verifier ≠ doer, re-runs its OWN method library with OWN markers, issues VERIFIED / REJECTED / INCONCLUSIVE, attaches evidence, commits an immutable snapshot (sha256) |
| `poc.verifier.js`    | PoC validation: structure, observed evidence (a success claim without an observed response is not evidence), independence (same request twice ≠ two methods), and the ≥2-independent-methods bar for CRITICAL/HIGH |
| `roi.verifier.js`    | Rules-of-Engagement gate: re-execution is itself an exploit action; out-of-scope targets/actions are refused with the exact RoE rule |

## Contract (per finding)

1. Read the finding from the knowledge graph (Phase 8C) — not from agent memory.
2. Re-run the exploit in the sandbox (the planted localhost fixture; every
   request is jailed to the engagement target's host).
3. ≥2 independent methods for CRITICAL/HIGH (poc.verifier enforces).
4. Attach evidence to the graph finding (vulnerability row `evidence[]`).
5. Set the finding status: VERIFIED or REJECTED (INCONCLUSIVE = not verified).
   Refusals (verifier==doer, RoE, graph-absent) persist as REFUSED records.

Unverified findings NEVER reach `security/pipeline/phases/reporting.phase.js`:
the reporting phase consults the verification records and drops anything that
is not VERIFIED with an intact evidence hash.

## Immutable snapshot

At verification time the verifier commits `evidence_hash = sha256(canonical(`
`{finding graph state incl. attached evidence, verification core}))`. The hash
line itself is excluded from the snapshot (self-reference). `integrityCheck()`
recomputes the hash over the finding's CURRENT graph state; a mismatch — the
finding was modified after verification — flips the record to **INVALIDATED**
and reporting drops it, same as REJECTED.

## Independence rules

- **verifier ≠ doer**: the same identity may never verify its own exploit
  (rule `VERIFIER_IS_DOER`, REFUSED).
- **own methods**: the verifier derives attempts from the vulnerability class
  (OWASP + location) using its own payloads and markers — never the doer's.
- **strict observation**: markers must appear verbatim in the response;
  server-side escaping defeats naive substring checks (the fixture's
  `/announce` trap exists precisely to prove this).
- **no guessing**: an unknown vulnerability class yields INCONCLUSIVE —
  the verifier never invents methods to reach VERIFIED.
