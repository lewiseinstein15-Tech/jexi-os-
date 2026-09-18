#!/usr/bin/env bash
# JEXI OS — convert the canonical structure into every harness format (Phase 7 H).
#
#   scripts/convert-harnesses.sh [--only <adapter-id>] [--out <dir>] [--strict]
#
# For each adapter: convert() → write to /tmp/jexi-harness-<id>/ and print
# what was written per harness. --strict exits nonzero on canonical errors (CI).

set -euo pipefail
cd "$(dirname "$0")/.."
exec node harness/adapters/_cli.js convert "$@"
