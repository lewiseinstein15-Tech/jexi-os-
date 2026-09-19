# JEXI OS — Data Provenance Labels (Phase 9 Scope G)

Every OSINT data point that JEXI produces or displays carries a provenance
label so the user knows what kind of data it is. **No silent inference. No
"looks real so it must be real."** Code: `label.js` (engine). Law:
`schema.js` (vocabulary, confidence matrix, strict validator).

The vocabulary is the one Scope A anticipated in
`intelligence/trust-pipeline/registered-urls.js:11-15`; every registration
there already declares the default label for its data (`provenance` field).

## The four labels (exactly)

| Label            | Meaning                                                    | Confidence     |
| ---------------- | ---------------------------------------------------------- | -------------- |
| `observed`       | Real measurement / direct fetch from a registered source   | optional       |
| `estimated`      | Interpolated, inferred, or derived from observed data      | **required**   |
| `simulated`      | Mock / demonstration / test — never a real measurement     | optional       |
| `reconstructed`  | Best-effort rebuild from partial or stale data (GEV "RECONSTRUCTED ESTIMATE") | **required** |

## Contract

```js
import * as label from '../events/provenance/label.js';

label.attach(dataPoint, { label, source, method, confidence?, notes? })
// → { data: <original data>, provenance: {
//      label, source, method, confidence?, timestamp: ISO, notes? } }

label.check(dataPoint)   // → boolean — has a schema-valid provenance field?
label.of(dataPoint)      // → provenance | null
label.assertAll(points)  // → count; throws E_MISSING_PROVENANCE /
                         //   E_INVALID_PROVENANCE naming index + preview
label.travel(point, newData) // → new envelope; provenance copied VERBATIM
label.summarize(points)  // → { total, counts, distinctLabels, mixed, conflict }
label.finalizeSet(points)// → assertAll + explicit mix flag (see rules)
label.wrapBroker(broker) // → broker whose ok results carry provenance (P9 seam)
```

Convenience attachers: `attachObserved`, `attachEstimated`,
`attachSimulated`, `attachReconstructed` (label pre-declared).

The envelope form `{ data, provenance }` is canonical: `attach` never
mutates caller data, provenance is frozen, keys are built in a fixed order
(`label, source, method, confidence?, timestamp, notes?`) so same-shape
provenance is byte-comparable across processes (P10).

## Rules

1. **No data point leaves the system without a label.** `assertAll` is the
   egress gate for arrays; `finalizeSet` for result sets. A point whose
   provenance field is present but garbage is treated as UNLABELED (it
   throws) — an invalid label must never count as labeled.
2. **`simulated` is never mixed with `observed` in the same result set
   without explicit flagging.** `finalizeSet` detects the co-presence and
   returns the set with `mixed: true, conflict: true,
   flag: 'SIMULATED_MIXED_WITH_OBSERVED'` plus a `flagDetail`. The set is
   never silently returned as if uniform.
3. **Confidence is required for `estimated` and `reconstructed`**
   (`E_CONFIDENCE_REQUIRED` otherwise), optional for the others; when
   present it must be a finite number in [0.0, 1.0].
4. **Labels travel with the data through every transformation.**
   Identity-preserving transforms (filter / sort / project / reshape) use
   `travel()`, which copies the source provenance verbatim — a query
   result retains the label FROM THE SOURCE. Deriving NEW values
   (interpolation, inference, rebuild from partial/stale) is NOT travel:
   it must `attach` `estimated` or `reconstructed` with confidence.
   Keeping `observed` on derived data is label laundering.
5. **No relabeling.** `attach`/`travel` refuse envelope-in-envelope
   re-wrapping (`E_ALREADY_LABELED`); provenance objects are frozen, so a
   `simulated` point cannot be silently upgraded to `observed` in place.

## Error codes (ProvenanceError)

| Code                   | When                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| `E_MISSING_LABEL`      | attach without `options.label`                                    |
| `E_INVALID_LABEL`      | label not one of the four / registration declares a bad one       |
| `E_INVALID_SOURCE`     | source missing or empty                                           |
| `E_INVALID_METHOD`     | method missing or empty                                           |
| `E_CONFIDENCE_REQUIRED`| estimated/reconstructed attached without confidence               |
| `E_INVALID_CONFIDENCE` | confidence not a finite number in [0.0, 1.0]                      |
| `E_INVALID_NOTES`      | notes present but not a non-empty string                          |
| `E_INVALID_DATA_POINT` | null/undefined data point                                         |
| `E_ALREADY_LABELED`    | re-wrapping an already-labeled envelope                           |
| `E_MISSING_PROVENANCE` | assertAll/travel on an unlabeled point (names index + preview)    |
| `E_INVALID_PROVENANCE` | provenance present but fails schema (names first schema error)    |
| `E_INVALID_SET`        | assertAll/summarize on a non-array                                |
| `E_INVALID_ARG`        | bad argument to wrapBroker                                        |

## Integration points

### Trust pipeline broker (P9)

- Seam: `intelligence/trust-pipeline/broker.js:74` (`fetchThroughBroker`)
  — successful results are built at `broker.js:177-190` (the `ok: true`
  return); refused/failed fetches produce no data (`:86`, `:121`, `:135`,
  `:162`, `:170`), so they correctly carry no label.
- Composition proof shipped here: `label.wrapBroker(broker)` adds
  `result.provenance` to every `ok` result, label taken from the
  registration's declared `provenance` (`registered-urls.js:32`), source
  from `registration.provider`.
- **Zone-owner task** (`intelligence/trust-pipeline/**` is Scope A's
  zone): insert the provenance assignment at `broker.js:177-190` —
  `result.provenance = <makeProvenance from registration>` — or route all
  fetches through `wrapBroker`. One line. Nothing else changes.

### Layers (`intelligence/layers/*`)

`intelligence/layers/` does not exist yet (built in Scope I). The rule it
must follow is declared NOW so it is enforced when it lands:

- Every layer declares its label type at ingress: direct-fetch layers
  (earthquakes, flights, satellites, fires, radio, bikeshare, launches,
  traffic, ships, map-stack) attach `observed` per record with
  `source = registration.provider`; layers that derive values (gap-fills,
  interpolations, aggregations) attach `estimated`; layers that rebuild
  from partial/stale snapshots attach `reconstructed`.
- Fixture/demo outputs inside a layer attach `simulated`.
- Layer egress MUST pass `assertAll` (records) or `finalizeSet` (sets).
- Wiring those files is future-scope work, not silently skipped: at build
  time (2026-09-19) the directory does not exist (verified in the probe
  report), so there is nothing to wire yet.

## Probe map (scripts/phase9-g-probe.mjs)

| Case | Proves                                                                  |
| ---- | ----------------------------------------------------------------------- |
| p1   | `observed` on a real USGS earthquake record; full provenance pasted; frozen label survives tampering attempt |
| p2   | `estimated` — real midpoint interpolation between two observed events, confidence required |
| p3   | `simulated` on a test fixture                                            |
| p4   | `reconstructed` — partial fields + stale timestamp, confidence + reason  |
| p5   | Labels travel: naive transform strips the label, `travel()` restores it byte-for-byte |
| p6   | Mixed set (3 observed + 1 simulated) explicitly flagged, never uniform   |
| p7   | `estimated` without confidence → refused (E_CONFIDENCE_REQUIRED)         |
| p8   | Unlabeled point through assertAll → throws naming the offending point    |
| p9   | Real Scope A broker fetch → every ok result carries `observed` automatically (registry-driven); integration file:line shown |
| p10  | Determinism: same inputs → same provenance shape (timestamps differ)     |
| p11  | Store/query round-trip through a real disk file — label intact           |

## Honesty notes

- Provenance `timestamp` is the moment of LABELING, not the observation
  time; stale observation time lives in the data itself (see p4).
- `wrapBroker` labels the fetch RESULT; per-record labeling happens at
  layer ingress (each record inherits the result's source via
  `attachObserved` — demonstrated in p9).
- No test doubles anywhere in the probes: P1/P2/P4/P5/P6/P9 run against
  live USGS data; P9 runs the real Scope A broker end-to-end.
