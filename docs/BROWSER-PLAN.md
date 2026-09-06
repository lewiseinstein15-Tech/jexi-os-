# BROWSER ACCESS — THE PLAN (Lewis's note, Sept 2026)

**Status today, honestly:** the three browser servers (playwright,
playwright-ea, chrome-devtools) connect and list their tools everywhere.
They can only *drive* a browser where one is installed. The free brain
server has no browser — on purpose: a browser eats more memory than the
whole free server has, and adding one would bring back the crashes we
fixed (the brain used to die whenever it started two servers at once).

**The promise:** we WILL find a way to give JEXI browser access on the
brain. When we do, it unlocks: real Google-grade web browsing, testing
of the apps JEXI builds in the Workshop, screenshotting any page, and
filling forms — all through the same three servers that are already
connected and waiting.

## The paths we will take (in order of preference)

1. **A genuinely free, keyless hosted browser appears.** The MCP world
   moves fast (hosted docs servers appeared this month). We watch the
   catalogs; the day a free browser MCP exists, we add it like the other
   42 — tested many times, proven live, no key, no pay.
2. **Run the full image where memory allows.** The repo already builds a
   full image WITH Chromium. Any machine with 2GB+ (a laptop, a home
   server, a friend's PC) runs JEXI with full browser control — flip
   `JEXI_NO_BROWSER=0`. Nothing to build; it's ready today.
3. **Upgrade the brain's plan (Lewis's call, money involved).** The
   moment the Render service moves to a bigger tier, we ship the full
   image and browser control turns on for the hosted brain too. One
   setting — the servers are already wired.
4. **JEXI drives the phone's own browser.** The Android app already has
   a browser in it. A future build could let JEXI operate THAT browser
   through the app — free, no new server, browser already on the device.
   IDEA stage — not designed yet, not promised until tested.

## Rule that never changes

No faking it. Until a path is real and proven live, the browser servers
say exactly what they are: connected and ready, waiting for a browser.
