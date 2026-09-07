# ARENA — Complete JEXI OS Rebuild Spec

> ⚠️ **HONESTY NOTE:** This file is a **reconstruction from working notes**, written
> after the original conversation was compacted. Lewis's re-sent 38-part message
> could not be preserved word-for-word. Every REQUIREMENT below is real and
> binding (it drove the audit in `REBUILD-MAP.md`), but the exact wording and
> the precise part numbers marked "(approx.)" are mine. If the verbatim text is
> wanted for the archive, Lewis can re-send it and it will be swapped in 1:1.
> Nothing in this file is invented: every item traces to Lewis's actual orders.

---

## THE MISSION

Rebuild JEXI from the existing repository into a **fast, persistent, autonomous
executive AI system**. Audit first. Do not preserve architectural problems. No
fake prototypes, no simulated activity, no "just add more agents/tools".

## PART 1 (approx.) — Performance is first-class

- No LLM chains per request. The flow is:
  `USER → KERNEL → INTENT → fast-path-or-mission → work graph → deterministic
  execution → model only when reasoning is needed → verify → respond`.
- "hello" must NOT trigger the pipeline.
- Track model calls per request + a latency breakdown for every stage.

## PART 2 (approx.) — Executive Kernel

A software control layer that owns every request: metering, gating,
fast-pathing, and routing — before any expensive work happens.

## PART 3 (approx.) — Intent Engine

Deterministic-first. Cheap rules decide intent; the model is only asked when
the rules genuinely cannot.

## PART 4 (approx.) — Reasoning stack

Provider-agnostic `ReasoningEngine → ModelRouter → ModelProvider`. One brain,
many possible hands.

## PART 5 (approx.) — Model-agnostic providers

Any provider must be swappable by configuration, never by code surgery.

## PART 6 — Ollama as ONE provider

- `MODEL_PROVIDER=ollama` + `MODEL_NAME` switchable.
- **Method (Lewis's explicit instruction):** the sandbox must NEVER run real
  Ollama or local models ("your sandbox keep stucking you"). The provider is a
  pure HTTP client against Ollama's OpenAI-compatible `/v1` endpoint on
  Lewis's own hardware; tests use a mock HTTP server only.

## PART 7 (approx.) — Context Engine

Relevant context only. No bloat, no kitchen-sink prompts.

## PART 8 (approx.) — Persistent Work Graph

The mission engine. State survives restarts.

## PART 9 (approx.) — Real Scheduler

Real scheduling of real work — not a pretend ticker.

## PART 10 (approx.) — Dependency-aware parallel execution

Independent work runs in parallel; dependent work waits for its inputs.

## PART 11 (approx.) — Mid-task steering

Change course mid-mission: preserve completed work, replan only the affected
parts.

## PART 12 (approx.) — Multiple concurrent missions

## PART 13 (approx.) — Agents are workers

Agents are units of labor inside missions — not a rigid hierarchy Lewis must
manage by hand.

## PART 14 (approx.) — Capability routing

Work goes to whoever/whatever can actually do it.

## PART 15 (approx.) — Centralized Tool Registry

One registry; no scattered ad-hoc tool wiring.

## PART 16 (approx.) — MCP = connectors only

MCP servers are connectors in the registry. Curated community-trust servers
stay disabled + `force:true`. No on/off switches in the UI — JEXI manages them.
Everything curated is default-ON with zero user action.

## PART 17 (approx.) — Browser Router

Android / Desktop / Remote browser workers. No Chrome private storage, no
unsafe bridges, no CAPTCHA bypass. Fully observable browsing.

## PART 18 (approx.) — JEXI Market stays external

One-way, authenticated, external-capability abstraction only. Never merge or
import its code.

## PART 19 (approx.) — Memory Vault lifecycle

`FRESH → AGING → STALE → REVERIFY`. Memory that decays and re-checks itself.

## PART 20 (approx.) — Observer

Watches execution honestly; feeds verification and recovery.

## PART 21 (approx.) — Verification

Outputs are verified before they reach Lewis.

## PART 22 (approx.) — Recovery

Failures are survived: retry, replan, or honest escalation.

## PART 23 (approx.) — Self-improvement

Improvements are proposed, sandbox-validated, then applied. Never blind.

## PART 24 (approx.) — Real JEXI conversation

JEXI speaks from ACTUAL runtime events ("Boss, I've started. I'm inspecting
the repository first…"), never from scripted fake activity.

## PART 25 (approx.) — Security: permission classes

`READ / WRITE / EXECUTE / NETWORK / EXTERNAL_SERVICE / SENSITIVE /
DESTRUCTIVE / FINANCIAL`. High-impact operations require authorization.
No prompt can override security.

## PART 26 (approx.) — Desktop UI

Dark background, warm branding, left nav (Home / Missions / Agents / Memory /
Tools / Files / Settings), central conversation HERO, optional right mission
panel, bottom input. No giant cards inside the conversation.

## PART 27 (approx.) — Phone UI

☰ hamburger at top. **NO bottom navigation bar.**

## PART 28 (approx.) — Palette

Dark cinematic + **orange / coral / salmon / peach**. NO neon green.

## PART 29 (approx.) — Typography

Handwriting font for JEXI's dialogue and notes (mature, not childish); clean
type for code / logs / JSON.

## PART 30 (approx.) — Motion

Meaningful animation only. No fake AI activity animations.

## PART 31 — Lewis profile

- Lewis. GitHub: `lewiseinstein15-Tech`. Kenya.
- BSc Computer Science, Kibabii University.
- Works from Android / Termux / proot / ARM64.
- JEXI OS = main project (creator/owner — "Who built you?" → **"Lewis built me"**).
- Noctryx AI = distinct, earlier project. JEXI Market = separate.
- Prefers Qwen / DeepSeek / Ollama / free providers.
- Hates fake capabilities: if it doesn't work, SAY SO. Casual tone mirrored,
  correctness never sacrificed. "I can't confirm that yet" when unverified.

## PART 32 (approx.) — No paid API keys

Everything must work with zero payment.

## PART 33 (approx.) — Don't fake it

No fake AGI/autonomy/learning/memory claims. Never claim untested capabilities.
CAN-DO / DESIGNED / TESTED / EXPERIMENTAL distinctions are kept honest.

## PART 34 (approx.) — Preserve JEXI's personality

## PART 35 — Testing matrix

hello · question · coding · research · multi-step mission · parallel ·
recovery · replanning · interruption · model failure · tool failure ·
memory retrieval · Ollama · browser · desktop UI · phone UI.
Measure model calls + latencies for each.

## PART 36 (approx.) — Phased delivery

Phases with tests + commits. Don't replace working components. No unnecessary
dependencies. Ask only when genuinely ambiguous / risky / irreversible.

## PART 37 — NO PUSH until ordered

Build, test, benchmark, screenshot, show evidence — then STOP and WAIT for
Lewis to say **"PUSH AND COMMIT TO GITHUB"**.

## PART 38 — Definition of done

All checkboxes complete + REAL screenshots from the running app + benchmarks +
README + tests passing → STOP → show evidence → WAIT.
