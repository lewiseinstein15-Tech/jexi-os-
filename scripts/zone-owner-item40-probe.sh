#!/usr/bin/env bash
# ZONE-OWNER ITEM 40 LIVE PROBE — server/evaluation/RESULTS.md hygiene.
# Run from repo root:  bash scripts/zone-owner-item40-probe.sh
# Proves: RESULTS.md is untracked but kept on disk, the exact-path ignore
# rule catches it, run.js/tasks.js stay tracked, git status stays clean when
# the evaluation runs, and — the item's real demand — the writer does NOT
# break on a fresh clone: with the file ABSENT, `node evaluation/run.js`
# recreates it (header + table + today's row) and passes the 0.90 gate;
# a second same-day run REPLACES the row instead of duplicating it.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."

checks=0; fails=0
check() { # label ok(1/0) detail
  checks=$((checks+1))
  if [ "$2" = "1" ]; then echo "PASS  $1"
  else echo "FAIL  $1 — $3"; fails=$((fails+1)); fi
}

F="server/evaluation/RESULTS.md"

# 1. untracked; siblings still tracked
t="$(git ls-files "$F" | wc -l | tr -d ' ')"
sib="$(git ls-files server/evaluation/ | tr '\n' ' ')"
check "RESULTS.md untracked; run.js + tasks.js still tracked" \
  "$([ "$t" = "0" ] && echo 1 || echo 0)" "ls-files '$F'=$t; tracked: $sib"

# 2. kept on disk
check "RESULTS.md still exists on disk (history preserved locally)" \
  "$([ -f "$F" ] && echo 1 || echo 0)" "missing"

# 3. ignore rule matches, exact path
v="$(git check-ignore -v "$F" 2>/dev/null || true)"
check "git check-ignore matches the exact-path rule" \
  "$(printf '%s' "$v" | grep -c 'server/evaluation/RESULTS.md$' | grep -q '^[1-9]' && echo 1 || echo 0)" "got: ${v:-<not ignored>}"

# 4. fresh-clone simulation: file ABSENT → writer recreates it, gate passes
BAK="/tmp/item40-results-backup.md"
cp "$F" "$BAK"
rm -f "$F"
( cd server && node evaluation/run.js > /tmp/item40-run1.log 2>&1 )
r1=$?
tail -3 /tmp/item40-run1.log | sed 's/^/    [run1] /'
check "writer with NO pre-existing file: exit 0 (0.90 gate passed)" "$([ "$r1" = "0" ] && echo 1 || echo 0)" "exit=$r1"
hdr="$(head -1 "$F" 2>/dev/null || true)"
today="$(date -u +%F)"
row="$(grep -c "^| ${today} |" "$F" 2>/dev/null || echo 0)"
check "recreated file has the canonical header + exactly one row for today ($today)" \
  "$([ "$hdr" = '# JEXI Evaluation Suite — results over time' ] && [ "$row" = "1" ] && echo 1 || echo 0)" "header='${hdr:-<none>}' rows=$row"

# 5. same-day re-run REPLACES the row (no duplicates)
( cd server && node evaluation/run.js > /tmp/item40-run2.log 2>&1 )
r2=$?
row2="$(grep -c "^| ${today} |" "$F" 2>/dev/null || echo 0)"
check "same-day re-run: exit 0 and still exactly ONE row for today (replace, not append)" \
  "$([ "$r2" = "0" ] && [ "$row2" = "1" ] && echo 1 || echo 0)" "exit=$r2 rows=$row2"

# 6. git status stays clean through both runs (the whole point of the item)
st="$(git status --short -- "$F" | grep -v '^D ' | wc -l | tr -d ' ')"
check "git status clean of RESULTS.md after evaluation runs (no suite side-effect)" \
  "$([ "$st" = "0" ] && echo 1 || echo 0)" "$(git status --short -- "$F" | tr '\n' ';')"

# restore the local history file (untracked now — content is local-only)
cp "$BAK" "$F"
rm -f "$BAK"
hist="$(grep -c '^| 20' "$F" || true)"
check "prior local history restored on disk (informational)" "$([ "$hist" -ge 1 ] && echo 1 || echo 0)" "rows=$hist"

echo
echo "===== PROBE TALLY: $checks checked, $((checks-fails)) pass, $fails fail ====="
[ "$fails" -eq 0 ] && exit 0 || exit 1
