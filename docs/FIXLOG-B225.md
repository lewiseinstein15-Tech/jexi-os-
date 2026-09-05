# FIXLOG B225 — the alternative-infrastructure build

**Premise:** the user's directive — work around the environment blockers with
free alternatives, make sure everything works. Three gaps closed, zero paid
services, zero fakes.

## 1. Part 13 — AndroidRuntime adapter (the big one)

The audit's only open row said the AndroidRuntime adapter "does not exist —
not claimed, not faked." The alternative was hiding in plain sight: **a phone
or emulator with USB debugging IS a computer-use target**, and adb is the
free, standard, real automation surface every Android device ships.

`server/src/services/AndroidRuntime.js`:
- **terminal** — `adb shell <cmd>` (argv-precise spawn, no host shell)
- **browser** — `am start -a VIEW -d <url>` opens the real device browser;
  observation reads the real accessibility tree (`uiautomator dump` →
  numbered elements with labels + bounds, EditText→input, clickable→button)
- **input** — taps at parsed bounds centers, `input text` with adb's real
  escaping (space→`%s`, single-quoted), keyevent map (ENTER 66, BACK 4, …),
  `wm size`-grounded swipes
- **screenshots** — `screencap -p` via `exec-out`, PNG-magic validated
- **files** — `adb push`

Wired into `ComputerRuntime.js` (5th provider) and the browser loop
(`ComputerOps.js`): android routes through the adapter, NOT DesktopManager —
**no host Chromium needed at all**. The B212 honesty pattern is preserved:
no adb / no device → ONE `COMPUTER_BLOCKED` with the true reason, never a
round of dead actions. Honest-absence paths everywhere: junk screencap →
unavailable (never a fake image); a11y tree has no DOM title → empty (never
a guess); unknown endpoint → `does not implement`.

**Testing (test-b225.js):** a stub adb BINARY (argv-precise recorder + canned
outputs, clearly labeled, never shipped) proves exact argv (incl. `-s
emulator-5554`), real XML→element parsing, center-of-bounds taps, escaping,
PNG validation, and every honest-absence path — plus a full browser-round e2e
over the adapter (4 actions, observation from the dump, zero blocks) and the
no-adb blocked path. Activation: `COMPUTER_RUNTIME=android` (+ optional
`JEXI_ANDROID_SERIAL`), documented in ANDROID.md.

`test-computer-runtime.js` updated for the new truth: 5 providers, android
capabilities real, configured flag mirrors actual adb presence (18/18).

## 2. Discovery composes assignments (B223's "feeds nothing" closed)

`recommendedToolsForSubtask(discovery, subtask)` (Director.js, exported,
unit-tested): intersects discovery's `matchedCapabilities` with the subtask's
capability + requirements. Matches ride the assignment brief ("Recommended
tools for this assignment (matched to the objective by discovery): …") and
the `EMPLOYEE_SELECTED` event (`recommendedTools`). **Recommendation only** —
the B52 allowlist and B209 permission gate still run at execution; nothing is
injected. Null when nothing matches: absence stays honest.

## 3. Voice input — the browser is the microphone

The documented gap said "no local mic daemon." The alternative: the user's
own browser. `Composer.jsx` gains a mic button on the Web Speech API —
zero keys, zero server cost, free forever. Feature-detected: no engine →
**no button** (never a dead button; the APK's WebView honestly gets none).
Interim results stream into the draft; errors surface honestly ("Microphone
blocked — allow mic access…"); the recognizer can never outlive unmount.

## Docs

- `ANDROID.md` — the adapter section + honesty contract + activation.
- `JEXI_ARCHITECTURE_AUDIT.md` — row 8 (Part 13) **DONE — B225**. The audit
  ledger is now fully closed: rows 1–9 all DONE.
- `CAPABILITY_MATRIX.md` — rows 33 (AndroidRuntime) + 34 (voice input +
  discovery composition).
- `GENERAL_INTELLIGENCE_AUDIT.md` — §9 limits updated with the B225 paths.
- `IMPLEMENTATION_REPORT.md` — Part 13 + discovery-composition entries
  closed; remaining list updated.

## Verification

- `test-b225.js` — **32/32** standalone.
- `test-computer-runtime.js` 18/18 · `test-b211b3.js` green · `test-b223.js`
  17/17 · `test-b224.js` 10/10 · `test-api-surface.js` green (regression).
- vite build green; full chain green (see below for the run in this fixlog's
  commit).

## Remaining (honest, unchanged by this build)

Worker pool (per-mission batches of 3, not cross-mission), imagination-lesson
polish (deterministic by design), non-browser provenance residual (grounded
rubric, not a hard gate), 7 dead UI fixtures (test-coupled), dsh parity utils
(unconsumed), free-tier ceilings (Groq TPD / Gemini RPM), prod host Chromium
(slim image, `JEXI_NO_BROWSER=1` — now sidesteppable by pointing
`COMPUTER_RUNTIME=android` at a real device).
