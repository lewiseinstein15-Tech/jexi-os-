# JEXI OS — Visual QA Harness (Phase 9 Scope H)

Headless-browser QA for JEXI's own UI: real captures, real PNG diffs,
real scene observations — and a **clean exit path when no browser is
available** (a SKIP, never a crash, never a fake screenshot).

## Modules

| File | Role |
| ---- | ---- |
| `puppeteer-runner.js` | Flavor detection + headless `capture()` + CI CLI |
| `screenshot-diff.js`  | Pure-Node PNG codec (zlib, zero imaging deps) + pixel diff |
| `scene-qa.js`         | 3D scene checks for Scope J's globe (canvas/WebGL/pixel probes) |
| `README.md`           | this contract |

## Flavor detection — "use whichever is real"

`detectBrowser()` tries, in order, and never throws:

1. **puppeteer** — preferred, if actually installed *with* its bundled Chromium
2. **playwright-core / playwright** — real downloaded Chromium
   (`~/.cache/ms-playwright/chromium-*/…`); **this is what exists in the
   current sandbox** (proven: Phase 6 `scripts/arena-screenshots.mjs`,
   Scope H probes)
3. **runtimes/browser/** (Phase 17 "Obscura") — existence checked; currently
   absent, no adapter wired (honest)
4. **none** → every entry point returns a clean skip (below)

`JEXI_VISUAL_NO_BROWSER=1` forces the skip path deterministically — the
SAME code path as real absence, used by probes to prove skip semantics.

## Contract

```js
runner.capture(url, { viewport, waitFor }) → {
  ok: boolean,
  screenshot: Buffer,        // PNG bytes; null on skip/failure
  errors: string[],          // pageerrors + console.error from the page
  durationMs: number,
  reason?: 'BROWSER_UNAVAILABLE',  // skip path only
  detail?: string, flavor?: string, url?: string
}

diff.compare(before, after, { threshold, pixelTolerance }) → {
  changed: boolean,          // pctDiff > threshold (threshold: percent 0..100)
  pixelsDiff: number,        // pixel differs iff max(|dR|,|dG|,|dB|) > pixelTolerance
  pctDiff: number,           // percent 0..100
  diffImage: Buffer,         // PNG: differences in red, matches dimmed gray
  totalPixels, width, height, threshold, pixelTolerance
}

scene.check(url, spec) → {
  ok: boolean,               // all observations pass
  observations: [{ what, expected, actual, pass }],
  errors, durationMs, reason?/detail?   // skip path: ok:false + reason
}
```

Scene spec schema (for Scope J's self-contained 3D globe HTML):
`SCENE_SPEC_EXAMPLE` in `scene-qa.js` — title match, element
present/visible checks, and canvas checks: present, WebGL context
creatable, min width/height, center-pixel-not-near-black (real pixel
readback via clip screenshot + PNG decode).

## Skip semantics (the important part)

| Situation | Behavior |
| --------- | -------- |
| No browser flavor available | `capture` → `{ ok:false, reason:'BROWSER_UNAVAILABLE', screenshot:null }`; `scene.check` → `{ ok:false, reason:'BROWSER_UNAVAILABLE', observations:[] }` — no throw, no fake data |
| CLI, browser missing | exit `0` with `--skip-ok`, exit `2` without |
| Browser present, page error | `ok:false` with the page error in `errors[]` — an honest failure, exit 1 |

Nothing anywhere synthesizes a screenshot or observation. A skip is
always distinguishable from a pass.

## PNG codec notes

- `encodePng(w, h, rgba)` — RGBA in, 8-bit color-type-6 PNG out (zlib
  level 9, filter 0, hand-rolled CRC32).
- `decodePng(buf)` — 8-bit non-interlaced, color types 0/2/4/6
  (everything Chromium and encodePng emit). Adam7 interlace, other bit
  depths, palette PNGs → `DiffError('E_UNSUPPORTED_PNG')` — refused
  loudly, never mis-decoded.
- Dimension mismatch in `compare` → `DiffError('E_DIMENSION_MISMATCH')`.
- Alpha is ignored in diffs (screenshots are opaque); antialiasing noise
  is handled by `pixelTolerance`, page-level noise by `threshold`.

## CI exit codes (CLI)

```
puppeteer-runner.js detect
puppeteer-runner.js capture <url> [--out f.png] [--width N] [--height N] [--skip-ok]
puppeteer-runner.js compare <before.png> <after.png> [--threshold N] [--pixel-tolerance N] [--diff-out f.png]
```

| Outcome | Exit |
| ------- | ---- |
| capture ok / compare unchanged | **0** |
| compare changed (real regression) or hard failure | **1** |
| skip (browser unavailable) with `--skip-ok` | **0** (output says skipped) |
| skip without `--skip-ok` | **2** |

CI gates on these directly.

## Integration point (P11, zone-owner task)

`server/src/services/director/Verifier.js:41` — `BROWSER_CLAIM_RE` (B213
method provenance): the Director's verifier flags deliverables that
*claim* real-browser work without real evidence. The visual QA harness is
the natural REAL evidence generator behind that gate: instead of only
rejecting suspicious claims, the Director could route the claim through
this harness (capture the deliverable's URL / run scene checks) and
verify against pixels. Wiring requires `server/src/**` edits → **zone-owner
task**, not actioned by Scope H.

## Probe map (scripts/phase9-h-probe.mjs)

| Case | Proves |
| ---- | ------ |
| p1 | real capture of https://example.com at 1440x900 (runner boots) |
| p2 | buffer size, PNG format + dimensions, duration |
| p3 | two real captures of the same page → changed=false, pctDiff=0 |
| p4 | two different pages → changed=true, pctDiff>0, diff image |
| p5 | threshold accepts a small real diff (changed=false, pixelsDiff>0) |
| p6 | diff image written to disk, byte size shown |
| p7 | forced no-browser → { ok:false, reason:'BROWSER_UNAVAILABLE' } — skip, not crash |
| p8 | real scene.check on a known static page (element observations) |
| p9 | CI exit-code matrix: 0 / 1 / skip-0 (--skip-ok) / skip-2 |
| p10 | determinism: byte-identical captures, or pixel-identical with documented encoder non-determinism |
| p11 | integration point cited + verified at runtime (Verifier.js:41) |

## Honesty notes

- The runner prefers Puppeteer *by name* because the directive prefers
  it; it is not installed here, so the Playwright flavor (real Chromium
  binary) is what actually runs. The flavor used is reported in every
  result (`flavor` field) — no silent substitution.
- Local `file://` fixture pages are used for diff/determinism probes:
  they remove network flakiness from the *diff logic under test* while
  remaining real browser renders; the network path itself is proven by
  p1/p2/p8 against https://example.com.
- Runtime artifacts live in `scratch/` and are never committed.
