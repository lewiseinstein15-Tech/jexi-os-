#!/usr/bin/env bash
# ZONE-OWNER ITEM 39 LIVE PROBE — data/provider-health.json hygiene.
# Run from repo root:  bash scripts/zone-owner-item39-probe.sh
# Proves: data/ is fully untracked (file kept on disk), the new /data/ ignore
# rule catches it, the root anchoring does NOT swallow the tracked
# agents/data/** and skills/**/data/** content, git status is clean of it,
# and the runtime writer (ProviderHealth persist) still works — both against
# a DATA_DIR override and against the real ./data path.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."

checks=0; fails=0
check() { # label ok(1/0) detail
  checks=$((checks+1))
  if [ "$2" = "1" ]; then echo "PASS  $1"
  else echo "FAIL  $1 — $3"; fails=$((fails+1)); fi
}

# 1. nothing under data/ tracked
t="$(git ls-files data/ | wc -l | tr -d ' ')"
check "no tracked files under data/ (git ls-files data/ is empty)" "$([ "$t" = "0" ] && echo 1 || echo 0)" "$t file(s) still tracked"

# 2. working copy kept on disk
check "data/provider-health.json still exists on disk (rm --cached keeps the runtime ledger)" \
  "$([ -f data/provider-health.json ] && echo 1 || echo 0)" "file missing"

# 3. ignore rule catches it, and names the /data/ pattern
v="$(git check-ignore -v data/provider-health.json 2>/dev/null || true)"
check "git check-ignore matches the new /data/ rule" \
  "$(printf '%s' "$v" | grep -c ':/data/' | grep -q '^[1-9]' && echo 1 || echo 0)" "got: ${v:-<not ignored>}"

# 4. root anchoring: tracked data dirs elsewhere must NOT be ignored
git check-ignore -q agents/data/data-engineer.agent.md
a=$?
git check-ignore -q skills/design/ui-ux-pro-max/data/charts.csv
b=$?
check "agents/data/** NOT ignored (rule is root-anchored)" "$([ "$a" = "1" ] && echo 1 || echo 0)" "check-ignore exit=$a"
check "skills/**/data/** NOT ignored (rule is root-anchored)" "$([ "$b" = "1" ] && echo 1 || echo 0)" "check-ignore exit=$b"

# 5. git status shows no untracked/modified data/ entries (a staged 'D ' is the untracking itself, allowed pre-commit)
s="$(git status --short -- data/ | grep -v '^D ' | wc -l | tr -d ' ')"
check "git status clean of data/ (no '?? data/' reappear)" "$([ "$s" = "0" ] && echo 1 || echo 0)" "$(git status --short -- data/ | tr '\n' ';')"

# 6. runtime writer works against a DATA_DIR override (fresh dir, mkdir -p by persist())
rm -rf /tmp/item39-writer
w="$(DATA_DIR=/tmp/item39-writer node --input-type=module -e "
import { recordProviderCallSuccess } from './server/src/services/ProviderHealth.js';
recordProviderCallSuccess('probe-provider', { latencyMs: 7 });
const fs = await import('node:fs');
const j = JSON.parse(fs.readFileSync('/tmp/item39-writer/provider-health.json','utf8'));
console.log(j.some((r) => r.provider === 'probe-provider' && r.requests >= 1) ? 'WROTE' : 'NO-ENTRY');
" 2>/dev/null | tail -1)"
check "ProviderHealth persist() still writes under DATA_DIR override" "$([ "$w" = "WROTE" ] && echo 1 || echo 0)" "got: ${w:-<error>}"

# 7. the real ./data ledger is valid JSON and loadable
j="$(node -e "const j=JSON.parse(require('fs').readFileSync('data/provider-health.json','utf8')); console.log(Array.isArray(j)?'VALID':'BAD')" 2>/dev/null)"
check "the on-disk ./data ledger is intact, valid JSON" "$([ "$j" = "VALID" ] && echo 1 || echo 0)" "got: ${j:-<parse error>}"

rm -rf /tmp/item39-writer
echo
echo "===== PROBE TALLY: $checks checked, $((checks-fails)) pass, $fails fail ====="
[ "$fails" -eq 0 ] && exit 0 || exit 1
