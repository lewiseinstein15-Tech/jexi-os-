#!/usr/bin/env bash
# ARENA — SELF-HEALING REPO: RESTORE SIDE
#
# Run this the moment you suspect a wipe (git log shows old commits, or git
# errors about missing config). It is SAFE on a healthy repo (no-op) and
# NEVER touches the working tree — it only heals .git's history from the
# bundle. Uncommitted changes stay exactly as they are.
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${JEXI_BACKUP_DIR:-/home/user/jexi-os-backup}"
BUNDLE="$BACKUP_DIR/jexi-os.bundle"

if [ ! -f "$BUNDLE" ]; then
  echo "✗ no bundle at $BUNDLE — nothing to restore from."
  exit 1
fi

# the backup's HEAD
BHEAD="$(git bundle list-heads "$BUNDLE" 2>/dev/null | awk '/refs\/heads\/main$/ {print $1}')"
[ -n "$BHEAD" ] || { echo "✗ bundle has no main ref"; exit 1; }

# current state (tolerate a dead .git entirely)
if [ ! -d .git ]; then
  echo "• .git missing entirely — initializing"
  git init -q
  git config user.name "Lewis"
  git config user.email "lewis@jexi-os.dev"
fi
CHEAD="$(git rev-parse main 2>/dev/null || echo missing)"

if [ "$CHEAD" = "$BHEAD" ]; then
  echo "✓ already current at ${BHEAD:0:8} — no restore needed."
  # still make sure identity + hook exist (config can vanish alone)
  git config user.name >/dev/null 2>&1 || { git config user.name "Lewis"; git config user.email "lewis@jexi-os.dev"; }
  [ -f .git/hooks/post-commit ] || cp scripts/hooks/post-commit .git/hooks/post-commit 2>/dev/null || true
  exit 0
fi

echo "• stale: main=${CHEAD:0:8} backup=${BHEAD:0:8} — healing from bundle"

# bring the history in without touching the working tree
git fetch -q "$BUNDLE" main:refs/heads/arena-restored

# stand main up (if main is missing, create it at the restored point)
if [ "$CHEAD" = "missing" ]; then
  git symbolic-ref HEAD refs/heads/arena-restored
  git branch -m main
else
  # move main to the restored HEAD; --mixed resets ONLY HEAD+index, the
  # working tree is untouched — uncommitted work survives as dirty files
  CURRENT_BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo main)"
  [ "$CURRENT_BRANCH" = "main" ] || git checkout -q main 2>/dev/null || git symbolic-ref HEAD refs/heads/main
  git reset -q --mixed arena-restored
fi
git branch -q -D arena-restored 2>/dev/null || true

# restore identity (wipes eat .git/config — the remote PAT is NOT restored
# here on purpose: fetch it from the operator's notes when pushing)
git config user.name >/dev/null 2>&1 || { git config user.name "Lewis"; git config user.email "lewis@jexi-os.dev"; }

# reinstall the post-commit hook
[ -d scripts/hooks ] && cp scripts/hooks/post-commit .git/hooks/post-commit 2>/dev/null || true
chmod +x .git/hooks/post-commit 2>/dev/null || true

# report honestly: what HEAD is now, and what is uncommitted on top of it
echo "✓ healed: main → $(git rev-parse --short main) ($(git log -1 --format=%s main | head -c 80)...)"
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
if [ "$DIRTY" != "0" ]; then
  echo "! $DIRTY uncommitted files in the tree (work done after the last backup) — commit + bash scripts/arena-backup.sh"
fi
