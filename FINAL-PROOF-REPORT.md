# JEXI OS — Final Proof Report (live-mission hardening)

> Built the way it will be run: real server, real local model, real tool
> execution. Every claim below names the artifact that proves it.

## 1. Proof environment (the smallest honest rig)

| Fact | Value | Proved by |
|---|---|---|
| Host | 2 GB RAM sandbox, CPU-only | `free -m` |
| Model | `qwen2.5:0.5b` via Ollama (only model that loads here; 1.5b/1b OOM at load, qwen3:0.6b leaves 91 MB free) | ollama load errors |
| JEXI | `server/index.js` on :18095, `MODEL_PROVIDER=ollama`, `JEXI_MCP_MINIMAL=1` | boot log `0/42 up, 42 left ready` |
| Inference speed | ~80 tok/s prompt eval, ~11 tok/s generation | measured turns |

## 2. Missions run (serial, single lane)

| Mission | Objective | Outcome | What it proved |
|---|---|---|---|
| ms-mttbbkf1-001 | math 2/3+1/4 | COMPLETED (false pass: echo + wrong verify) | E2E machinery; exposed echo + provenance bugs |
| ms-mttbtxgj-002 | math (rerun) | FAILED (qwen3-resident swap timeout) | env failure, honest cascade |
| ms-mttc98kq-003 | math (solo) | COMPLETED pass 1.00, **wrong answer 5/12 claimed as success over exit-1** | exposed failure-denial |
| ms-mttch5os-001 | isPrime write+run | FAILED 3×91s stream aborts | exposed wall-clock stream kill |
| ms-mttcrisy-001 | isPrime (rerun) | FAILED planning 107s abort | exposed non-stream 90s cap |
| ms-mttd0ewg-001 | isPrime (rerun) | FAILED 3×180s ramble | exposed unbounded generation |
| ms-mttdjd7z-001 | isPrime (bounded) | _running at report time_ | bounded turns complete (35–146s), real `node` runs, rebrief recovery |

## 3. Bugs found live + fixed (all committed, all tested)

| # | Bug | Fix | Test |
|---|---|---|---|
| F5.1 | Telemetry credited the lane *preference* (`groq`), not the generator (`ollama`) | `noteProvider()` from LLM meta → `MODEL_REQUEST_COMPLETED.data.provider` | live: `provider=ollama preferred=groq` + suite §1 |
| F5.2 | Verifier passed brief-echo as work (score 1.00) | Gate 1.7 template-echo (≥2 scaffolding fingerprints → fail) | suite §2 |
| F5.3 | Deliverable claimed success over exit-1-only record | Gate 1.5b failure-denial | suite §3 |
| F5.4 | Instant retry re-entered cooldown → 1s fail cascade | Cooldown-aware `RECOVERY_WAIT` (max cooldown + breather, cap 60s) | live-fired + suite §4 |
| F5.5 | Stream killed at fixed 90s wall-clock while producing | Progress-aware budget: 90s idle + 10 min cap | stub-server suite §5 |
| F5.6 | Non-stream local rung capped at 90s (107s plan turn died) | Ollama rung 5-min budget + `opts.timeoutMs` | stub-server suite §6 |
| F5.7 | Uncapped generation → 3×180s ramble, zero output | `maxTokens` employee 1500 / verify 600, plumbed incl. stream leg | forwarding suite §7 |
| F5.8 | MCP boot connected 42 servers (~460 MB) | `JEXI_MCP_MINIMAL=1` lazy rows | boot log + `test-mcp-minimal.js` |
| F5.9 | Budget/redirect stopped waiting but orphaned the stream (378s lane hog) | AbortSignal threaded round→attempt→leg; budget/redirect abort the fetch | suite §8 (pre/mid-stream abort) |

Suite: `server/test-f5-hardening.js` — **25/25, 3 consecutive runs**.
Regressions green: b208 (96), b213 (28), b199, b220 (7/0), b227 (11/0), b177,
llm-models, model-coworkers, onekey-providers (14), hermes-full, team-router.

## 4. Known limits (observed, not theorized)

1. **0.5b capacity**: wrong math, garbage planner nouns ("Short title"),
   run-before-write. Caught by deterministic gates where checkable; the rest
   is labeled model capacity, not architecture.
2. **Single-lane box**: concurrent missions starve each other (90s queue
   timeouts). Proof runs are serial; hosted backends have parallel capacity.
3. **Orphaned streams**: FIXED (F5.9) — budget/redirect now abort the leg.
   Observed before the fix: a 378s orphan hogging the single lane.
4. **Push blocked**: commits `1a626e0` + follow-ups are local-only (no GitHub
   credentials in this sandbox); operator pushes from their machine.

## 5. Acceptance gates (absolute)

_To be scored at the end of the run._
