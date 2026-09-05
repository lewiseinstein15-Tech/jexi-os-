# FIXLOG B227 — the image actually reaches the AI

**What the user reported:** "Check our logs — it is not describing what is
actually in the photo. Fix it. Stop telling me you fixed and you didn't."

**The user was right.** B226 verified that the *buttons* worked (photo sent,
question delivered) — never that the *answer described the photo*. This build
reproduces the real failure live, fixes it at every layer, and adds the live
grounding proof as a permanent test.

## The live reproduction (before this fix)

A generated photo of **three yellow rubber ducks on a red table** (plus a blue
mug and a green book) sent through the real `/api/chat`:

- **Run 1 (pre-B227):** answered by the *picture-SEARCH* Presenter with a
  random 1915 Wikimedia postcard — the attached photo was ignored entirely.
- **Run 2 (after the dispatcher fix):** correctly routed to the Vision node,
  but the model answered *"I'm afraid I can't directly view the image as it's
  not provided in the text"* — the image was still not reaching the model,
  and nothing in the logs said so.

## The fixes (five real drops/hijacks)

| # | Where | The bug | The fix |
|---|---|---|---|
| D | `index.js` Presenter fast path | "What do you **see** in this **image**" matched the picture-*search* detector → the turn was answered with stock photos, the attachment ignored | the Presenter never fires when an image is attached (`image ? null : detect…`); analysis verbs (describe/analyze/identify/what is in this/read this) added to the detector's block-words |
| A | `SimpleTask.js` | `opts.image` never read — the SIMPLE lane dropped every photo | validated image + a grounding instruction ("answer from what you ACTUALLY see… NEVER invent") rides the turn |
| B | `WorkerRouter.js` | plain lane hardcoded the image to `null`; the tools lane cannot carry images and silently swallowed them | vision turns carry the real image on the plain lane, skip the tools lane, and skip text-only providers (`VISION_PROVIDERS = groq|gemini|openrouter`) |
| C | `AgentLoop.js` | the prompt *told* the model an image existed without showing it — the model guessed | image turns make a direct vision call with the real photo attached |
| E | `Orchestrator.js` vision node | `plan.payload` was the only source; no observability; a blind model could hallucinate | `plan.payload || opts.image` (validated), the attached size is **logged** ("Analyzing image (148KB attached to the model)…"), a missing image answers honestly, and the call uses the `/api/vision`-proven `prefer: 'gemini'` lane |

## The live proof (after this fix)

Same photo, same question, real `/api/chat` on production:

> 🔍 Analyzing image (148KB attached to the model)…
>
> *"The image shows a red table with three bright yellow rubber ducks arranged
> in a row. To the left of the ducks is a green book titled 'THE POND'S TALE'.
> To the right of the ducks is a blue mug. In the background, there is a
> blurred view of a window with natural light coming through, a wooden chair,
> and a potted plant."*

**Grounding check: 7/7 expected words** (duck, yellow, red, mug, blue, green,
book — it even read the book title). The independent `/api/vision` probe
returns the same-quality description.

## Tests (test-b227.js — 11, in chain)

- The detector: analysis phrasing never triggers picture search; real picture
  requests still do (5 phrasings).
- The dispatcher contract: the Presenter is gated on `!image`.
- SIMPLE lane / WorkerRouter / AgentLoop / vision-node contracts, including
  the honest-absence branch and the size log.
- **Functional:** the image reaches the vision node through the real
  planner + graph (logged size verified); no keys → honest failure, never a
  fabricated description.
- **Opt-in live proof** (`JEXI_VISION_PROOF=1`): sends a real photo through a
  deployed brain and asserts the answer names what is actually in it — the
  "fixed means fixed" bar for vision from now on.

Full chain EXIT=0 (46 suites). Workflows 4/4 green. Render deploy
`dep-dae2jj32jpjc73dqcqa0` live and verified with the proof above.
