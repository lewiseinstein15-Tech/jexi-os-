---
id: python
loads: stack
---

# Python Rules

[JEXI-RULE python PY-1] One venv per project; pin requirements. No global pip installs.

[JEXI-RULE python PY-2] Type hints on public functions; new modules pass mypy or ruff type checks.

[JEXI-RULE python PY-3] No mutable default arguments — use `None` and build the default in the body.

[JEXI-RULE python PY-4] f-strings for formatting; `pathlib` over `os.path` for file handling.

[JEXI-RULE python PY-5] Format with black, lint with ruff; both clean before commit.

[JEXI-RULE python PY-6] No silent `except Exception` around real logic. Catch what you can handle; let the rest propagate.
