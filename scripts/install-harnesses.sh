#!/usr/bin/env bash
# JEXI OS — detect + install the converted harness files (Phase 7 H).
#
#   scripts/install-harnesses.sh [--dry-run] [--only <adapter-id>] [--root <dir>] [--force]
#
# Detects which harnesses are installed on this machine; for each detected
# harness: convert → install() into its config dir. Undetected harnesses are
# skipped cleanly. --dry-run shows what WOULD be installed, no writes.
# --root <dir> redirects all installs under a controlled test root.
# --force installs even when detection is negative (testing).

set -euo pipefail
cd "$(dirname "$0")/.."
exec node harness/adapters/_cli.js install "$@"
