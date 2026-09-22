# FIXLOG B197 — The REAL image blink/glitch/zoom fix

**Date:** 2026-09-03 · **Report:** *"when she generates a photo it is blinking and glitching then zooming in"*

B196 memoized the image component and removed the per-delta fade — the user
still saw all three symptoms live. This build finds and kills the four real
causes.

---

## Cause 1 — REMOUNT, not re-render (the blinking)

`MarkdownRenderer` built its `components={{ … }}` map **inline in the render
body**. react-markdown uses those functions as **React element types**; a
fresh object per render means fresh function identities, and React treats a
changed element type as a *different component* → it **unmounts and remounts
every custom-rendered node** on every streaming delta.

The `<img>` DOM node was destroyed and re-created hundreds of times
mid-stream. Each recreation: opacity 0 → shimmer → (re)load → fade-in. That
is the blinking. B196's `memo()` never helped — the memo wrapper was mounted
*inside* the recreated tree.

**Fix:** the map now lives at module scope (`MARKDOWN_COMPONENTS`, one frozen
identity). Deltas **reconcile** — the `<img>` node and its loaded state
survive the whole stream. Same fix applied to `RichAnswer` (its own inline
map → `useMemo(…, [])`), the second renderer.

## Cause 2 — the size pulse (the zooming)

The loading box reserved a flat `minHeight: 128` and **collapsed to the
image's real height (up to 400px) on load**. Remounting per delta made the
box pulse 128 ↔ 400px continuously — the "zooming in".

**Fix:** the **exact aspect ratio is reserved before load**:

- every generated image URL already carries `?width=&height=` (Pollinations)
  → `imgDimsFromUrl()` reserves the true box from the first paint;
- a session `IMG_DIM_CACHE` (src → natural dims, filled on first `onLoad`)
  makes every later render of the same src — the stream→finished swap,
  history, tab switches — reserve the exact box too;
- `.jx-imgbox` gained `max-height: 400px` so an aspect reservation can never
  overflow the image cap.

Zero layout shift, ever — including the first view of a generated photo.

## Cause 3 — the raw-URL text flash (the glitching)

While the image markdown streams in, the unterminated tail
`![a lion](https://image.pollinations.ai/…` rendered as **literal text**
until the closing paren arrived — a URL flashing on screen before the image.

**Fix:** `stripTrailingImageFragment()` holds back an unterminated image
token at the very end of the content (never crossing a newline). Such a tail
is invalid markdown anyway, so finished answers are unaffected — the image
appears once, complete, in its already-reserved box.

## Cause 4 — the ghost shimmer

The `shimmer-bar` class used by the image loading state (and BootSplash,
CommandCenter, HomeView) **had no CSS definition anywhere** — loading images
sat in a dead gray box.

**Fix:** a real animated shimmer sweep (`.shimmer-bar` + `@keyframes
jxshimmer`) — the loading state finally reads as "loading".

---

## Also

- Re-mounted images of an already-seen src start life `loaded` — no shimmer
  or fade replay on the stream→finished tree swap.
- `MarkdownImage` `onLoad` records `naturalWidth/Height` into the cache for
  every image, not just generated ones.

## Tests (19 new, `server/test-b197.js`)

Static: module-scope component map · no inline `components={{` · dim cache
filled on load · URL dim parsing · RichAnswer memoized · `.shimmer-bar` CSS
exists · box capped at 400px.
Behavioral (renders the real component via esbuild + react-dom/server):
stripper holds unterminated tails / passes complete markdown / never crosses
newlines · stable `img` element type · generated image renders with the exact
`aspect-ratio: 768 / 512` reservation · half-streamed URL never leaks as text
· delta-growth render keeps the image · dimensionless images still render ·
plain text unchanged.

**Suite: 3,947 checks, 0 failures (exit 0).**
