# UI REBUILD v2 — Phase 1: Premium Palette Research

**Status:** PROPOSAL — awaiting lead pick (A / B / C / D, or a stated mix). No app code
touched on this branch yet; this document and the mock-ups are the entire Phase 1 deliverable.

**Method:** Research grounded in real, current developer-tool design systems. Verified hexes
were pulled from public brand/design-system sources (listed per direction). Hexes marked
`≈` are approximations tuned from product UI where no authoritative source publishes exact
values — they are clearly flagged and can be adjusted before Phase 2 locks tokens.

**Mock-ups:** each direction has one chat-view screen rendered at 1440×900@2x
(`docs/ui-palette-previews/<slug>-chat.png`, HTML sources in `mockups/`). The mock-ups
double as a preview of the Phase 2 Arena-style narration structure: thinking block →
step list → command block → tool-call block → final answer → turn footer.

**Rejected premise from v1:** the previous rebuild reused the app's existing violet accent
(`#8B5CF6`). None of the four directions below reuse it as a signature accent.

---

## A — GRAPHITE · Refined Dark

**Source products:** Linear (primary anchor) × Raycast (secondary).
**Feels like:** a perfectly-tuned instrument in a dark studio — quiet, exact, nothing shouts.

| Token | Hex | Source status |
|---|---|---|
| bg-base | `#08090A` | ≈ Linear "Woodsmoke" dark canvas |
| bg-surface | `#101012` | ≈ Linear panel layer |
| bg-elevated | `#17181C` | ≈ Linear elevated layer |
| border-subtle | `#1F2023` | ≈ tuned |
| border-strong | `#2E3035` | ≈ tuned |
| text-primary | `#F7F8F8` | ≈ Linear "Black Haze" text |
| text-secondary | `#8A8F98` | ≈ Linear "Oslo Gray" |
| text-muted | `#62666D` | ≈ tuned |
| **accent (signature)** | **`#5E6AD2`** | ✅ verified — Linear brand indigo |
| accent-alt-1 | `#7B85E3` | ≈ indigo-light (hover) |
| accent-alt-2 | `#57C1FF` | ✅ verified — Raycast accent blue |
| success | `#4CB782` | ≈ Linear green |
| warning | `#F2994A` | ≈ Linear orange |
| danger | `#EB5757` | ≈ Linear red |
| info | `#57C1FF` | ✅ verified — Raycast |

**Typography:** Inter (UI, 400/500/600) · JetBrains Mono (code/labels). Linear ships Inter;
JetBrains Mono stands in for Berkeley Mono.
**Radius scale:** 6 / 8 / 12 px (sm / md / lg) — tight, Linear-like.
**Shadow scale:** `0 1px 2px rgba(0,0,0,.50)` (rest) · `0 8px 24px rgba(0,0,0,.45)` (float).
**Mock-up:** `docs/ui-palette-previews/a-graphite-chat.png`

---

## B — EMBER · Technical

**Source products:** Warp (primary anchor) × Fly.io (secondary).
**Feels like:** a terminal that learned typography — warm charcoal, hairline chrome, every block a readout.

| Token | Hex | Source status |
|---|---|---|
| bg-base | `#2B2622` | ✅ verified — Warp design-system canvas (warm charcoal) |
| bg-surface | `#383330` | ✅ verified — Warp "canvas-soft" |
| bg-elevated | `#453F3A` | ≈ extrapolated step above canvas-soft |
| border-subtle | `#3F3A36` | ✅ verified — Warp "hairline" |
| border-strong | `#554E47` | ≈ tuned |
| text-primary | `#F7F5F0` | ✅ verified — Warp "ink" |
| text-secondary | `#C9C0AD` | ✅ verified — Warp "body" |
| text-muted | `#AEA69C` | ✅ verified — Warp "mute" |
| **accent (signature)** | **`#E85C90`** | ≈ Warp rose, derived from Warp brand gradient (no official hex published) |
| accent-alt-1 | `#9D7BFF` | ≈ Fly.io violet family (no official hex published) |
| accent-alt-2 | `#FFC66D` | ≈ terminal amber |
| success | `#59D499` | ✅ verified — Raycast green (reads well on warm charcoal) |
| warning | `#FFC533` | ✅ verified — Raycast yellow |
| danger | `#FF6161` | ✅ verified — Raycast red |
| info | `#57C1FF` | ✅ verified — Raycast blue |

**Typography:** Inter (UI) + **DM Mono** (code/labels) — the verified Warp pairing.
**Radius scale:** 3 / 4 / 6 px — Warp-verified "extremely tight, almost rectangular."
**Shadow scale:** near-none; elevation via surface contrast + hairlines (Warp-verified
approach). Modal only: `0 2px 12px rgba(0,0,0,.40)`.
**Notes:** the only warm-canvas direction — deliberately distinct from every cool-grey
default in this list. Mono is used more aggressively (step numbers, footers, chips).
**Mock-up:** `docs/ui-palette-previews/b-ember-chat.png`

---

## C — IVORY · Editorial

**Source products:** Anthropic (primary anchor) × Claude.ai (secondary).
**Feels like:** a well-bound book on a warm desk — calm, literate, humane.

| Token | Hex | Source status |
|---|---|---|
| bg-base | `#F0EEE6` | ✅ verified — Anthropic "Ivory Medium" |
| bg-surface | `#FAF9F5` | ✅ verified — Anthropic oat/Pampas card |
| bg-elevated | `#FFFFFF` | ✅ verified |
| border-subtle | `#E2DED2` | ≈ tuned warm hairline |
| border-strong | `#CCC7B7` | ≈ tuned |
| text-primary | `#141413` | ✅ verified — Anthropic "Slate Dark" |
| text-secondary | `#5E5B54` | ≈ tuned warm gray |
| text-muted | `#8A867C` | ≈ tuned |
| **accent (signature)** | **`#D97757`** | ✅ verified — Anthropic clay / Crail family |
| accent-alt-1 | `#C46686` | ✅ verified — Anthropic "fig" |
| accent-alt-2 | `#6A9BCC` | ✅ verified — Anthropic "sky" |
| success | `#5F7E5A` | ≈ tuned to warm canvas |
| warning | `#C08A2D` | ≈ tuned |
| danger | `#B3412E` | ≈ tuned |
| info | `#6A9BCC` | ✅ verified — Anthropic "sky" |

**Dark-alt (documented, secondary):** bg `#262624` (✅ Claude.ai dark, verified) · surface
`#30302E` · elevated `#3A3A38` · text `#F5F4EF` / `#C2C0B6` / `#96948A` · border `#3F3E38`
/ `#55534A` · same clay accent. The signature form of this direction is the light ivory.

**Typography:** serif display (`Source Serif 4` standing in for Anthropic's Tiempos) +
Inter (standing in for Styrene) + JetBrains Mono.
**Radius scale:** 10 / 14 / 18 px — the softest of the four.
**Shadow scale:** `0 1px 3px rgba(20,19,18,.06)` · `0 12px 32px rgba(20,19,18,.08)` — warm, low-opacity.
**Mock-up:** `docs/ui-palette-previews/c-ivory-chat.png`

---

## D — SIGNAL · Bold

**Source products:** Railway (per lead's framing: deep black + coral) × Supabase (secondary).
**Feels like:** a bass-heavy club sound system — deep black, one loud signal color, impossible to ignore.

| Token | Hex | Source status |
|---|---|---|
| bg-base | `#0F0F0F` | ✅ verified — Supabase near-black |
| bg-surface | `#171717` | ✅ verified — Supabase surface |
| bg-elevated | `#212121` | ≈ tuned step |
| border-subtle | `#262626` | ≈ tuned |
| border-strong | `#3A3A3A` | ≈ tuned |
| text-primary | `#FAFAFA` | ≈ tuned (high contrast) |
| text-secondary | `#A3A3A3` | ≈ tuned |
| text-muted | `#616161` | ≈ tuned |
| **accent (signature)** | **`#FF5D5D`** | ⚠️ coral per lead's Railway framing — **not verifiable**: public sources describe Railway as "stark dark + vibrant purple accents" today; coral kept because the lead specified it |
| accent-alt-1 | `#3ECF8E` | ✅ verified — Supabase brand green |
| accent-alt-2 | `#635BFF` | ✅ verified — Stripe blurple |
| success | `#3ECF8E` | ✅ verified — Supabase green |
| warning | `#FBBF24` | ≈ tuned |
| danger | `#FF2E2E` | ≈ tuned (harder red than the coral signature) |
| info | `#635BFF` | ✅ verified — Stripe blurple |

**Typography:** Inter (UI, with Inter Display weights for headings) + JetBrains Mono.
**Radius scale:** 6 / 10 / 14 px.
**Shadow scale:** `0 0 0 1px #262626` (ring-style rest state) · `0 4px 16px rgba(0,0,0,.60)`
· accent glow `0 0 24px rgba(255,93,93,.22)` on primary actions.
**Mock-up:** `docs/ui-palette-previews/d-signal-chat.png`

---

## Side-by-side

| | A — GRAPHITE | B — EMBER | C — IVORY | D — SIGNAL |
|---|---|---|---|---|
| Direction | Refined Dark | Technical | Editorial | Bold |
| Anchors | Linear × Raycast | Warp × Fly.io | Anthropic × Claude | Railway × Supabase |
| Canvas | cool near-black | warm charcoal | warm ivory (light) | deep black |
| Signature | indigo `#5E6AD2` | rose `#E85C90` | clay `#D97757` | coral `#FF5D5D` |
| Type character | neutral grotesque | grotesque + mono-forward | serif display | display sans |
| Radius | 6/8/12 | 3/4/6 | 10/14/18 | 6/10/14 |
| Risk | closest to "safe" | warm canvas divides opinion | light theme flips the app | coral ≠ danger red needs discipline |

## Decision guidance

- Pick **A** if the console should feel like the tooling devs already trust — lowest-risk, most "professional."
- Pick **B** if the console should feel like a terminal product — most distinctive dark option, mono-forward.
- Pick **C** if the console should feel unlike any competitor — only light direction, strongest brand differentiation.
- Pick **D** if the console should feel loud and confident — strongest contrast, strongest accent presence.
- Mixes are supported (e.g. "A with B's mono-forward styling" or "D's contrast with A's indigo").

## Research sources

- Linear brand hexes: brandcolor.dev / mobbin.com palette pages (`#5E6AD2` indigo confirmed)
- Raycast: designlang.app brand guidelines (`#FF6363` anchor) + VoltAgent/awesome-design-md `raycast/DESIGN.md` (full token set)
- Warp: VoltAgent/awesome-design-md `warp/DESIGN.md` (canvas `#2B2622`, ink `#F7F5F0`, hairline `#3F3A36`, radius 3-4px, DM Mono pairing)
- Anthropic/Claude: styles.refero.design (Ivory `#F0EEE6`, Slate `#141413`), mobbin Claude palette (Crail `#C15F3C`), shadcn.io Anthropic design system (clay `#D97757`, fig `#C46686`, sky `#6A9BCC`), LinkedIn design analysis (Book Cloth `#CC785C`), Claude.ai dark surface `#262624` (Hermes CLI issue reference)
- Supabase: design-extractor.com + open-design DESIGN.md (`#0F0F0F`/`#171717` canvases, `#3ECF8E` green, `#00C573` link green)
- Vercel: design-extractor.com (`#171717`/`#FAFAFA`, Geist) — consulted for the monochrome baseline
- Stripe: multiple brand references (blurple `#635BFF`, navy `#0A2540`)
- Perplexity: shadcn.io + standards.site (cream `#FDFBFA`, teal `#016A71`) — consulted, not proposed
- **Not verifiable via public sources:** Railway's exact coral (lead's framing retained, flagged above), Fly.io's official purple, Warp's official gradient rose — all marked `≈` / `⚠️` in the tables
