---
id: golang
loads: stack
---

# Golang Rules

[JEXI-RULE golang GO-1] `gofmt` and `go vet` clean before commit. No exceptions.

[JEXI-RULE golang GO-2] Wrap errors with `%w` and handle every `err`. Assigning to `_` to swallow an error is a bug.

[JEXI-RULE golang GO-3] `context.Context` is the first parameter on anything that blocks, waits, or does IO.

[JEXI-RULE golang GO-4] Define interfaces at the consumer, keep them small (1–2 methods).

[JEXI-RULE golang GO-5] No panics in library code — return errors; panic only for programmer-mistake invariants.

[JEXI-RULE golang GO-6] Table-driven tests; run the race detector on concurrent paths.
