# Prompt Anti-Pattern Catalog (Phase 25, Scope L)

Reference for humans. The machine-readable catalog lives in `rules.js`;
`lint.run(prompt)` executes every rule below against a built prompt and
returns findings. `ok:true` requires **zero** error-severity findings —
`warn` and `info` findings are reported but never block.

Every finding names the rule, the location (section id + char offset, or
the pair of sections for duplicate/conflict), and the offending substring
as evidence. Detection is deterministic: same prompt, same findings, same
order, every run.

Severity legend: **error** = must be fixed (blocks) · **warn** = should be
fixed · **info** = worth noting.

---

## AP-GOD-PROMPT

- Severity: `error`
- Detects: one section consuming more than 50% of the total prompt char
  budget. A god-prompt section quietly swallows the build, distorts the
  model's attention, and hides structure that should be separate sections.
- Violation example: a `spec` section with 600 chars next to a 4-char
  `misc` section — `spec` is 99.3% of the prompt.
- Clean alternative: keep every section under 50% of total chars; split
  oversized sections by concern (rules vs actions vs context vs output).

## AP-VAGUE

- Severity: `warn`
- Detects: vague phrases in instructions — `use appropriate`, `when
  needed`, `if applicable`, `as necessary`, `where possible`. Vagueness
  delegates the decision to the model, which guarantees inconsistency.
- Violation example: `Handle edge cases when needed.`
- Clean alternative: `Handle these edge cases: (1) empty input -> refuse
  with E_EMPTY, (2) unknown section -> escalate to the user.`

## AP-BRANCHING-PROSE

- Severity: `warn`
- Detects: branching logic stated in prose — `if X then Y (else Z)`,
  `in the case that`, `depending on`. Prose branches are ambiguous and
  cannot be audited.
- Violation example: `If the section is missing then create it else
  refuse. Depending on the season, pick a greeting.`
- Clean alternative: enumerate the branches as numbered rules: `1. Section
  missing -> refuse with E_NO_SECTION. 2. Section present -> write to it.
  Greetings are fixed; there is no seasonal behavior.`

## AP-HARDCODED

- Severity: `warn`
- Detects: hardcoded values that should be variables — specific model
  names (`gpt-4o`, `claude`, `gemini`, ...), absolute file paths
  (`/etc/jexi/config.yaml`), magic numbers (`4096`), credential strings
  (`sk-...`). Values baked into a prompt rot silently when the
  environment changes.
- Violation example: `Use gpt-4o for every request. Config lives at
  /etc/jexi/config.yaml. Retry 4096 times.`
- Clean alternative: `Use the configured default model. Config lives at
  the path from JEXI_CONFIG env. Retry until the retry budget is
  exhausted.`

## AP-FLATTERY

- Severity: `error`
- Detects: flattery openers — `Great question`, `Excellent point`,
  `Certainly!`, `Of course!`. Sycophancy wastes tokens and biases the
  rest of the response toward agreement instead of correctness.
- Violation example: `Great question! Here is the migration plan...`
- Clean alternative: open with the substance: `Migration plan: 1. ...`

## AP-SOFT-CONSTRAINT

- Severity: `error`
- Detects: soft language in constraints — `should try`, `prefer to`,
  `when possible`, `consider`. Soft constraints are unenforceable; the
  model learns they can be skipped.
- Violation example: `You should try to validate input. Consider memory
  limits. When possible, stream output.`
- Clean alternative: `Validate input before use; refuse invalid input
  with E_INVALID. Respect the memory budget. Stream output when the
  transport supports it (this is a hard requirement, not a preference).`

## AP-NO-TERMINATION

- Severity: `warn`
- Detects: a doing-tasks section that states no termination condition —
  the model is told what to do but never when it is done, inviting
  rambling or half-finished work.
- Violation example: a `doing-tasks` section reading only `Work on the
  queue one item at a time. Keep notes short.`
- Clean alternative: append an exit condition: `Report when all steps are
  complete; a step counts as complete only after its live probe passes.`

## AP-DUPLICATE

- Severity: `warn`
- Detects: the same rule (normalized line) appearing in two or more
  sections. Duplicates drift apart over edits and double-count attention.
- Violation example: `Always verify the tag before any write.` appearing
  verbatim in both `system-rules` and `actions`.
- Clean alternative: keep the rule in exactly one section (its natural
  home) and reference it from the other: `Write guard: see system-rules.`

## AP-CONFLICT

- Severity: `error`
- Detects: two rules that contradict — the same predicate both commanded
  (`always X`) and forbidden (`never X`). A prompt that contradicts
  itself forces the model to guess which half to obey.
- Violation example: `system-rules` says `Always write the audit line.`
  while `actions` says `Never write the audit line.`
- Clean alternative: pick one behavior: `Always write the audit line`
  (delete the `never` variant), or scope them: `Always write the audit
  line for writes; never write one for read-only probes.`

---

## Extending the catalog

Phrase lists in `rules.js` are the enforcement surface and are meant to
grow: add the phrase to the rule's list (with the finding message and a
catalog entry here) rather than special-casing prompts. Rules where
detection is inherently fuzzy stay at `warn` — only unambiguous,
lead-pinned violations are `error`.
