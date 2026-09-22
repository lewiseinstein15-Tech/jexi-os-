# FIXLOG-B134 — Batch 3: ACP + terminal + credentials + sandbox policy + goal rounds

**Phase:** B134 · **Branch:** main

Pulled the next DeepSeek Harness subsystems (registry 199 → 205):

1. **acp** — an Agent Client Protocol server over JSON-RPC (POST /api/acp):
   initialize (protocol version + agent capabilities), session/new,
   session/prompt (runs JEXI's agent loop in-process and returns the agent
   message), session/cancel, session/delete — external agents can now drive
   JEXI. GET /api/acp/status for diagnostics.
2. **terminal/tool-terminal** — persistent shell sessions: terminal_open
   (owner-isolated, workspace cwd), terminal_send (stdin), terminal_read
   (drain output), terminal_signal (SIGINT…), terminal_close, terminal_list
   (8 sessions, 200KB buffers).
3. **credentials/credentials-local** — a managed credential store: keys
   validated (POSIX identifiers, non-empty values), stored 0600, the
   MANAGED STORE WINS OVER ENV (DSH precedence), delete falls back to env,
   listing exposes keys only. POST/GET/DELETE /api/credentials.
4. **sandbox/sandbox-policy** — per-session sandbox mode folded from the
   log (last sandbox/mode event wins — replayable): read-only |
   workspace-write | danger-full-access, with DSH-style denial guidance.
   sandbox_mode tool sets it; effectiveSandboxMode/denial available to the
   gate.
5. **goal/goal-round-driver** — goal rounds: get_goal reports
   {round, maxRounds, canContinue, complete}; edit/resume increment the
   round and the goal auto-completes when the cap is reached.

## Verified
- test-dsh-batch3 40/40 (ACP lifecycle incl. honest errors, real terminal
  I/O, credential precedence, sandbox fold + denial matrix, goal round cap).
- Counts: 252 agents · 508 skills · 205 tools; AGENT-CATALOG regenerated;
  roster audit clean (fixed a dangling system-admin agent ref); roster-skills
  cap adjusted for the larger registry; full 55-suite sweep exit 0; lint 0.
- Deployed to Render via hook.
