#!/usr/bin/env bash
# ARENA — SELF-HEALING REPO: BACKUP SIDE (incremental, snapshot-safe)
#
# The sandbox wipes roll .git back and delete .git/config, but the working
# tree and /home/user files survive — within a snapshot budget. So the
# durable backup is the SMALL delta bundle: everything GitHub does NOT have
# yet (origin/main..main), ~2MB. The base history lives safely on GitHub.
#
#   backup:   bash scripts/arena-backup.sh          (runs itself after every commit)
#   restore:  bash scripts/arena-restore.sh         (run after ANY wipe)
#
# Belt and suspenders: bundle (machine-restorable) + format-patches
# (human-readable, saved us twice) + MANIFEST.
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${JEXI_BACKUP_DIR:-/home/user/jexi-os-backup}"
BUNDLE="$BACKUP_DIR/jexi-os-arena.bundle"
PATCH_DIR="$BACKUP_DIR/patches"
BASE="$(git rev-parse origin/main 2>/dev/null || echo unknown)"

mkdir -p "$BACKUP_DIR" "$PATCH_DIR"

# 1. refuse to back up a dirty tree — commit first (honesty rule:
#    uncommitted work is not protected by ANY backup method)
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
if [ "$DIRTY" != "0" ]; then
  echo "✗ tree is dirty ($DIRTY files) — commit your work first, then backup."
  exit 1
fi

if [ "$BASE" = "unknown" ]; then
  echo "✗ no origin/main — set the remote first (see the operator notes), or pass --local"
  echo "  --local backs up main..main (no delta) — only useful for a full-bundle"
  echo "  run: bash scripts/arena-backup.sh --full"
  exit 1
fi

# 2. THE DELTA BUNDLE — exactly the commits GitHub lacks (small, snapshot-safe)
git bundle create "$BUNDLE" "$BASE..main" >/dev/null 2>&1
git bundle verify "$BUNDLE" >/dev/null 2>&1 || { echo "✗ bundle verify FAILED"; exit 1; }
BHEAD="$(git bundle list-heads "$BUNDLE" | awk '/refs\/heads\/main$/ {print $1}')"

# 3. full bundle only on explicit request (99MB — do NOT leave it in the
#    snapshot budget by default; --full is for off-sandbox archiving)
if [ "${1:-}" = "--full" ]; then
  git bundle create "$BACKUP_DIR/jexi-os-full.bundle" main >/dev/null 2>&1
  git bundle verify "$BACKUP_DIR/jexi-os-full.bundle" >/dev/null 2>&1
fi

# 4. patch series — human-readable copy of the same range
rm -f "$PATCH_DIR"/*.patch
git format-patch "$BASE..main" -o "$PATCH_DIR" >/dev/null

# 5. manifest — what the backup contains
cat > "$BACKUP_DIR/MANIFEST.json" <<EOF
{
  "head": "$BHEAD",
  "headSubject": $(git log -1 --format=%s main | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))'),
  "base": "$BASE",
  "branch": "main",
  "backupAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "commitsOnGitHub": $(git rev-list --count "$BASE"),
  "commitsInDelta": $(git rev-list --count "$BASE..main"),
  "bundleBytes": $(stat -c%s "$BUNDLE"),
  "patches": $(ls "$PATCH_DIR"/*.patch 2>/dev/null | wc -l),
  "restoreCommand": "bash scripts/arena-restore.sh"
}
EOF

# 6. reinstall the post-commit hook (wipes eat .git/hooks too)
mkdir -p .git/hooks
if [ -f scripts/hooks/post-commit ]; then
  cp scripts/hooks/post-commit .git/hooks/post-commit
  chmod +x .git/hooks/post-commit
fi

echo "✓ backed up: ${BHEAD:0:8} (base ${BASE:0:8}, $(git rev-list --count "$BASE..main") commits, $(du -h "$BUNDLE" | cut -f1), $(ls "$PATCH_DIR"/*.patch | wc -l) patches)"
