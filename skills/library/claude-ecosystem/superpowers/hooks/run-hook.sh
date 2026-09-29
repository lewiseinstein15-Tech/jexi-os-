#!/bin/sh
# JEXI OS — Phase 22 Scope D — POSIX-sh hook runner (superpowers pattern).
#
# Ported from obra/superpowers hooks/run-hook.cmd (MIT). Upstream's runner is
# a Windows/Unix polyglot batch file; this is the POSIX-sh form so the layer
# runs under /bin/sh. Upstream's contract is kept: take a script name, resolve
# it relative to this directory, exec it with the remaining arguments, and
# fail loudly (exit 1) when the name is missing or unknown.
#
# Usage: run-hook.sh <script-name> [args...]
#
# Each named script is rendered in POSIX sh as <name>.sh; if only the
# extensionless bash original exists, fall back to it.

set -u

if [ "$#" -eq 0 ] || [ -z "$1" ]; then
  echo "run-hook.sh: missing script name" >&2
  echo "usage: run-hook.sh <script-name> [args...]" >&2
  exit 1
fi

HOOK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRIPT_NAME=$1
shift

# Prefer the POSIX rendering, then the upstream bash original.
if [ -f "$HOOK_DIR/$SCRIPT_NAME.sh" ]; then
  exec /bin/sh "$HOOK_DIR/$SCRIPT_NAME.sh" "$@"
fi
if [ -f "$HOOK_DIR/$SCRIPT_NAME" ]; then
  exec bash "$HOOK_DIR/$SCRIPT_NAME" "$@"
fi

echo "run-hook.sh: no such hook script: $SCRIPT_NAME" >&2
exit 1
