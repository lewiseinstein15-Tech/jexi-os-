# CRASH screenshot classification — v012 phone/desktop chat

## Artifacts

- `v012-phone-chat-CRASH.png` — phone build, sidebar renders, chat pane empty.
- `v012-desktop-chat-CRASH.png` — desktop build, error boundary visible.

## Verbatim error (desktop boundary card)

> UI CRASH CAUGHT
> JEXI's interface hit an unexpected error while rendering this view. The
> backend is unaffected — your task keeps running.
>
> Minified React error #31; visit https://reactjs.org/docs/error-decoder.html?invariant=318&args[]=object%20with%20keys%20%7Bid%2C%20tts%2C%20parentEventId%2C%20priority%2C%20taskId%2C%20conversationId%2C%20state%2C%20agentId%2C%20agentName%2C%20type%2C%20title%2C%20summary%2C%20data%2C%20severity%7D ...

Decoded: **React error #31 — "Objects are not valid as a React child"**. The
crashed object carried the keys `id, tts, parentEventId, priority, taskId,
conversationId, state, agentId, agentName, type, title, summary, data,
severity` — i.e. a raw brain event object was rendered as a JSX child.

## Classification: REAL BUG in the v012 build generation — NOT reproducible on current main

1. The crashing object's schema (`tts`, `priority` fields) **does not exist
   anywhere in current `main`** — `rg '"tts"|tts:' server/src` matches only
   `VoiceAgent.js` engine hints, and no event emitter carries those fields
   (the current `teamEvent()` envelope in
   `server/src/services/director/TaskState.js` uses `ts`/`providerId` instead
   and has no `tts`/`priority`).
2. The current chat path **already guards against exactly this crash class**:
   `src/components/console/ChatView.jsx` routes `team` events through
   `typeof ev.event === 'object'` handling and a `str()` coercion helper, and
   narration items are stringified at push time (`str(ev.text)`), so an event
   object can no longer reach a JSX child position raw.
3. The error boundary itself worked as designed on both screenshots
   ("backend is unaffected — your task keeps running", RELOAD APP offered).

## Disposition

No code change required on current `main` — the emitting schema and the
unguarded render path are both gone. The screenshots document a stale-build
crash that later refactors (team-event guard + schema change) fixed
in passing. If the same boundary ever fires again on a current build, the
args list in the boundary card will name the offending keys.
