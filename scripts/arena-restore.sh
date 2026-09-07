#!/usr/bin/env bash
# ARENA — SELF-HEALING REPO: RESTORE SIDE
#
# Run the moment you suspect a wipe (git log shows old commits, git complains
# about missing config, or a fresh sandbox). Safe on a healthy repo (no-op)
# and NEVER touches the working tree — it heals .git only. Uncommitted
# changes survive exactly as they are.
#
# Recovery order:
#   1. delta bundle (needs the base commit — from local objects if present)
#   2. if the base is missing: fetch it from origin (GitHub) first
#   3. if no remote configured: print the exact command to run and exit 2
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${JEXI_BACKUP_DIR:-/home/user/jexi-os-backup}"
BUNDLE="$BACKUP_DIR/jexi-os-arena.bundle"
BASE="$(python3 -c 'import json;print(json.load(open("'"$BACKUP_DIR"'/MANIFEST.json"))["base"])' 2>/dev/null || echo unknown)"

if [ ! -f "$BUNDLE" ]; then
  echo "✗ no delta bundle at $BUNDLE — nothing to restore from."
  exit 1
fi

BHEAD="$(git bundle list-heads "$BUNDLE" 2>/dev/null | awk '/refs\/heads\/main$/ {print $1}')"
[ -n "$BHEAD" ] || { echo "✗ bundle has no main ref"; exit 1; }

# tolerate a dead .git entirely
if [ ! -d .git ]; then
  echo "• .git missing entirely — initializing"
  git init -q
fi
git config user.name >/dev/null 2>&1 || { git config user.name "Lewis"; git config user.email "lewis@jexi-os.dev"; }

CHEAD="$(git rev-parse main 2>/dev/null || echo missing)"

if [ "$CHEAD" = "$BHEAD" ]; then
  echo "✓ already current at ${BHEAD:0:8} — no restore needed."
  exit 0
fi

echo "• stale: main=${CHEAD:0:8} backup=${BHEAD:0:8} — healing"

# the delta bundle needs its base commit present. If the wipe ate it:
if ! git cat-file -e "$BASE^{commit}" 2>/dev/null; then
  if git remote get-url origin >/dev/null 2>&1; then
    echo "• base ${BASE:0:8} missing locally — fetching from origin"
    git fetch -q origin main
  else
    echo "✗ base commit ${BASE:0:8} is missing and no origin remote is configured."
    echo "  run:  git remote add origin <PAT-FETCH-URL>   (operator notes have it)"
    echo "  then: git fetch origin main && bash scripts/arena-restore.sh"
    exit 2
  fi
fi

# bring the history in WITHOUT touching the working tree
git fetch -q "$BUNDLE" main:refs/heads/arena-restored

# stand main up at the restored HEAD
if [ "$CHEAD" = "missing" ]; then
  git symbolic-ref HEAD refs/heads/arena-restored
  git branch -m main
else
  CURRENT_BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo main)"
  [ "$CURRENT_BRANCH" = "main" ] || { git symbolic-ref HEAD refs/heads/main; git reset -q --mixed HEAD -- . 2>/dev/null || true; }
  # --mixed moves HEAD+index only; the working tree is untouched —
  # uncommitted work done after the last backup survives as dirty files
  git reset -q --mixed arena-restored
fi
git branch -q -D arena-restored 2>/dev/null || true

# reinstall the post-commit hook
[ -f scripts/hooks/post-commit ] && cp scripts/hooks/post-commit .git/hooks/post-commit 2>/dev/null || true
chmod +x .git/hooks/post-commit 2>/dev/null || true

echo "✓ healed: main → $(git rev-parse --short main) — $(git log -1 --format=%s main | head -c 90)"
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
if [ "$DIRTY" != "0" ]; then
  echo "! $DIRTY uncommitted files (work done after the last backup) — commit + bash scripts/arena-backup.sh"
fi
