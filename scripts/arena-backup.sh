#!/usr/bin/env bash
# ARENA — SELF-HEALING REPO: BACKUP SIDE
#
# The sandbox wipes roll .git back and delete .git/config, but the working
# tree and /home/user files survive. This script makes the repo's history
# durable in ONE bundle file that lives OUTSIDE the repo, restorable with
# arena-restore.sh in seconds — no patch dance, no network needed.
#
#   backup:   bash scripts/arena-backup.sh          (run after EVERY commit)
#   restore:  bash scripts/arena-restore.sh         (run after ANY wipe)
#
# Belt and suspenders: the bundle is the machine-restorable copy; the
# format-patches in the same directory stay as the human-readable copy that
# saved us twice already.
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${JEXI_BACKUP_DIR:-/home/user/jexi-os-backup}"
BUNDLE="$BACKUP_DIR/jexi-os.bundle"
PATCH_DIR="$BACKUP_DIR/patches"
BASE="$(git rev-parse origin/main 2>/dev/null || echo unknown)"

mkdir -p "$BACKUP_DIR" "$PATCH_DIR"

# 1. refuse to bundle a dirty tree — commit first, backup after (honesty rule)
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
if [ "$DIRTY" != "0" ]; then
  echo "✗ tree is dirty ($DIRTY files) — commit your work first, then backup."
  echo "  (uncommitted work is NOT protected by any backup method)"
  exit 1
fi

# 2. THE BUNDLE — full history of main in one restorable file
git bundle create "$BUNDLE" main >/dev/null 2>&1
git bundle verify "$BUNDLE" >/dev/null 2>&1 || { echo "✗ bundle verify FAILED"; exit 1; }
BHEAD="$(git bundle list-heads "$BUNDLE" | awk '/refs\/heads\/main$/ {print $1}')"

# 3. belt and suspenders — human-readable patch series from the base
if [ "$BASE" != "unknown" ]; then
  rm -f "$PATCH_DIR"/*.patch
  git format-patch "$BASE..main" -o "$PATCH_DIR" >/dev/null
fi

# 4. manifest — what the backup contains, for humans and restore checks
cat > "$BACKUP_DIR/MANIFEST.json" <<EOF
{
  "head": "$BHEAD",
  "headSubject": $(git log -1 --format=%s main | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))'),
  "base": "$BASE",
  "branch": "main",
  "backupAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "commits": $(git rev-list --count main),
  "bundleBytes": $(stat -c%s "$BUNDLE"),
  "patches": $(ls "$PATCH_DIR"/*.patch 2>/dev/null | wc -l),
  "restoreCommand": "bash scripts/arena-restore.sh"
}
EOF

# 5. reinstall the post-commit hook (wipes eat .git/hooks too)
mkdir -p .git/hooks
if [ -f scripts/hooks/post-commit ]; then
  cp scripts/hooks/post-commit .git/hooks/post-commit
  chmod +x .git/hooks/post-commit
fi

echo "✓ backed up: ${BHEAD:0:8} → $BUNDLE ($(du -h "$BUNDLE" | cut -f1), $(ls "$PATCH_DIR"/*.patch 2>/dev/null | wc -l) patches)"
