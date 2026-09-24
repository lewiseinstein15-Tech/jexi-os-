# BROWSER RUNTIME — Obscura engine

Phase 17 Scope A. Obscura replaces Chromium as the browser engine.

| | Obscura | Headless Chrome |
|---|---|---|
| Memory | ~30 MB | 200+ MB |
| Binary | ~70 MiB | 300+ MB |
| Anti-detect | built in | none |
| Page load | ~85 ms | ~500 ms |
| Startup | instant | ~2 s |

Measured on this host (Phase 17 Scope A probe, `example.com`, one page loaded):

| Engine | RSS, cold (no page) | RSS, page loaded |
|---|---|---|
| Obscura | **24.1 MB** | 54.6 MB |
| Chromium (playwright headless shell) | — | 394.4 MB |

Obscura's README quotes 30 MB; the figure depends on the build feature set and
the page. Both numbers above are `ps` RSS sums for the engine's process tree.

## Why this matters here

`docs/BROWSER-PLAN.md` states the free brain server has no browser *because a
browser eats more memory than the whole free server has*, and that adding one
brought back the crashes that were fixed. A CDP-compatible engine at ~24 MB
cold is what makes path 2 of that plan ("run the full image where memory
allows") unnecessary for the hosted brain.

## Files

| File | Role |
|---|---|
| `engine.js` | spawns `obscura serve`, owns the CDP endpoint, reports RSS |
| `stealth.js` | identity/stealth configuration + consistency checking |
| `fallback.js` | the no-Chromium-fallback policy, enforced in code |
| `index.js` | facade: availability probe, runtime, Playwright connect |
| `compose.yaml` | Docker deployment (loopback-published port) |
| `../../scripts/phase17-a-probe.mjs` | live probe P1–P6 |
| `cdp.js` | raw CDP client — flattened sessions, no npm dependency |
| `dom-service.js` | DOM → indexed element list with stable durable keys |
| `actions/` | 59 browser actions behind a permissioned registry |
| `agent-loop.js` | observe → think → act cycle |
| `../../scripts/phase17-b-probe.mjs` | live probe P1–P7 |

## Scope B — actions and the agent loop

`actions/` holds **59 actions** in eight groups (navigation 8, interaction 12,
forms 6, tabs 7, dialogs 5, extraction 7, dom_mutation 9, files 5). Every action
declares a JSON Schema for its input and output, a risk level, the permissions it
needs, a timeout, and its retry policy; `dispatch()` validates the input and the
handler's result against those schemas, so a malformed call fails as an
`ActionValidationError` instead of reaching the page.

`agent-loop.js` runs observe → think → act. `think` calls an injected `decide`
function, so a scripted planner drives the identical code path a model would —
which is what makes the probe reproducible without mocking the browser.

### Engine behaviour the actions have to absorb

Both of these were found by the Scope B probe and are handled in code:

- **Static inline elements report a 0×0 box.** Obscura returns
  `width: 0, height: 0` from `getBoundingClientRect()` for a rendered static
  inline element such as a bare `<a>`. Treating a zero-size box as hidden drops
  real links from the snapshot, so `dom-service.js` decides visibility from the
  ancestor chain instead. A side effect is correct handling of a child whose
  parent is `display:none`: the child's own computed `display` still reads
  `inline`, so only the ancestor walk catches it.
- **A click on a zero-box element**. `performClick` falls back to a DOM
  `el.click()` when the target has no clickable box, and reports
  `method: "dom-click"` with a note. The probe prints which path each click took.

## Install

```bash
# Linux x86_64, stealth + rendering build
curl -LO https://github.com/h4ckf0r0day/obscura/releases/latest/download/obscura-x86_64-linux-stealth.tar.gz
tar xzf obscura-x86_64-linux-stealth.tar.gz -C ~/obscura
~/obscura/obscura --version
```

Archives are named by feature set: no suffix = rendering, `-stealth` =
rendering + stealth, `-no-render` = neither, `-no-render-stealth` = stealth
without rendering. Linux builds target Ubuntu 22.04 and need glibc 2.35+.
`obscura-worker` must sit next to `obscura`; both come in the archive.

Docker (the documented deployment path):

```bash
docker run -d --name obscura -p 127.0.0.1:9222:9222 h4ckf0r0day/obscura:latest
```

## Use

```js
import { createBrowserRuntime, obscuraAvailability } from './runtimes/browser/index.js';

obscuraAvailability();                       // honest verdict, never throws
const rt = await createBrowserRuntime({ stealth: true });
rt.cdpUrl;                                   // ws://127.0.0.1:9222
const browser = await rt.connectPlaywright(); // connectOverCDP
```

Binary discovery order: `$OBSCURA_BIN`, `~/obscura/obscura`,
`/usr/local/bin/obscura`, `/usr/bin/obscura`, `/opt/obscura/obscura`, then
`which obscura`. Transport `auto` prefers a local binary, then Docker.

## Connecting a CDP client

Playwright must use `connectOverCDP`, not `connect` — `connect` speaks
Playwright's own protocol.

```js
const browser = await chromium.connectOverCDP('ws://127.0.0.1:9222');
const context = browser.contexts()[0] ?? await browser.newContext();
const page = await context.newPage();
await page.goto('https://example.com');
```

## No Chromium fallback

If Obscura is unavailable, `ObscuraUnavailableError` is thrown. The runtime
never silently starts Chromium. A silent engine swap would invalidate every
memory and stealth figure measured against Obscura — and the deployment target
is exactly the memory-constrained host where the fallback would fire.

The Chromium path in `DesktopManager` is untouched and still reachable by
calling it directly. Explicit is allowed; implicit is the bug.

## Known limits

Obscura is not Chromium. Per its own documentation:

- Playwright `page.video()` and desktop-capture tracing are not implemented.
  Use raw CDP `Page.startScreencast` for page frames.
- `BrowserContext` storage-state save/restore is limited. Use `--storage-dir`.
- Service workers, native media, some Web APIs, long-tail CSS and compositor
  behaviour are incomplete relative to Chromium.
- PDF text is not selectable/searchable; tagged PDF is not available.

Stealth is identity consistency plus tracker blocking. It does **not** handle
Cloudflare interactive challenges, Datadome/Akamai active challenges, CAPTCHAs,
or IP-based rate limiting. CAPTCHA/challenge bypass is refused by
`server/src/services/BrowserRouter.js` policy and is out of scope here.
