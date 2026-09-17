---
id: rust
loads: stack
---

# Rust Rules

[JEXI-RULE rust RS-1] No `unwrap()` / `expect()` outside tests. Propagate with `?` and contextual errors.

[JEXI-RULE rust RS-2] Clippy clean; deny warnings on CI paths.

[JEXI-RULE rust RS-3] Ownership first: borrow before you clone, and justify every `.clone()` that stays.

[JEXI-RULE rust RS-4] `thiserror` for library errors, `anyhow` at the binary edge.

[JEXI-RULE rust RS-5] `cargo test` and `cargo build` pass before commit.

[JEXI-RULE rust RS-6] Every `unsafe` block carries a `// SAFETY:` comment and gets reviewed.
