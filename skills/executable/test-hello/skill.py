"""Canonical executable-skill example: importable by python-skill.js."""


def run(args):
    name = str((args or {}).get("name", "world"))
    return {"greeting": f"hello {name}"}
