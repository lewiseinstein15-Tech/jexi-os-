#!/usr/bin/env bash
# Per-ticket acceptance evidence.
#
# Runs each ticket's acceptance test file on its own and records the RAW output,
# so every "fixed" claim in the report can be traced to a command that ran.
# A ticket is only marked proven if its file exits 0 with zero failures.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

# The ticket set needs Node >= 22 for `node:sqlite`, which the WorkGraph and
# verification paths use. Put a newer node first on PATH if one is available.
for _n in /tmp/node-v24*/bin /tmp/node-v22*/bin; do
  [ -x "$_n/node" ] && export PATH="$_n:$PATH" && break
done
[ -d node_modules ] || npm install --no-audit --no-fund >/dev/null 2>&1

OUT="${1:-/home/user/jexi-os-/server/ticket-evidence}"
mkdir -p "$OUT"

# ticket-file : label
FILES=(
  "jexi-001-011-015-sandbox.test.js|JEXI-001,011,015 sandbox + terminal"
  "jexi-002-008-009-013-016-codingloop.test.js|JEXI-002,008,009,013,016 coding loop"
  "jexi-003-004-005-012-023-fs.test.js|JEXI-003,004,005,012,023 filesystem"
  "jexi-005-path-confinement.test.js|JEXI-005 path confinement"
  "jexi-006-024-014-testing.test.js|JEXI-006,014,024 test execution"
  "jexi-007-024-025-verify.test.js|JEXI-007,024,025 verification"
  "jexi-010-028-profiles.test.js|JEXI-010,028 permission profiles"
  "jexi-016-019-structure.test.js|JEXI-016,019 structure"
  "jexi-017-018-020-021-026-030.test.js|JEXI-017,018,020,021,026,030 runtime"
  "jexi-agent-tools-reach-model.test.js|JEXI-002,021 tool surface reaches the model"
  "jexi-live-stream.test.js|STREAM live bridge — NDJSON transport"
  "jexi-lean-lane-streaming.test.js|STREAM lean lane streams deltas"
  "jexi-skill-relevance-floor.test.js|RELEVANCE skills library match floor"
  "jexi-e2e-planted-pytest.test.js|JEXI-029 end-to-end planted pytest"
)

TOTAL_PASS=0
TOTAL_FAIL=0
FAILED_FILES=()
SUMMARY="$OUT/_summary-lines.txt"
: > "$SUMMARY"

for entry in "${FILES[@]}"; do
  f="${entry%%|*}"
  label="${entry##*|}"
  raw="$OUT/$f.raw.txt"
  {
    echo "================================================================"
    echo "TICKETS : $label"
    echo "COMMAND : node --test tests/tickets/$f"
    echo "RUN AT  : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "NODE    : $(node --version)"
    echo "================================================================"
  } > "$raw"
  node --test "tests/tickets/$f" >> "$raw" 2>&1
  rc=$?
  # node's test runner ships two reporters and the default changed in v22:
  #   TAP  (older)   "# pass 3"  / "# fail 0"
  #   spec (newer)   "i pass 3"  / "i fail 0"   (glyph U+2139)
  # Reading only the TAP shape made every file report pass=0 while the script
  # still printed PROVEN — a false green in the evidence itself, which is the
  # exact failure this ticket set exists to prevent.
  p=$(grep -aE "^# pass |pass [0-9]+$" "$raw" | tail -1 | grep -oaE "[0-9]+$")
  fl=$(grep -aE "^# fail |fail [0-9]+$" "$raw" | tail -1 | grep -oaE "[0-9]+$")
  p=${p:-0}; fl=${fl:-0}
  TOTAL_PASS=$((TOTAL_PASS + p))
  TOTAL_FAIL=$((TOTAL_FAIL + fl))
  {
    echo ""
    echo "----------------------------------------------------------------"
    echo "EXIT CODE : $rc"
    echo "PASSED    : $p"
    echo "FAILED    : $fl"
  } >> "$raw"
  # PROVEN requires a clean exit, zero failures, AND a non-zero pass count.
  # A file that ran nothing is not a passing file.
  if [ "$rc" -eq 0 ] && [ "$fl" -eq 0 ] && [ "$p" -gt 0 ]; then
    verdict="PROVEN"
  else
    verdict="FAILED"
    FAILED_FILES+=("$f")
    [ "$p" -eq 0 ] && echo "  !! $f reported 0 passing tests — not counted as proven" >&2
  fi
  echo "$label :: exit=$rc pass=$p fail=$fl :: $verdict" >> "$SUMMARY"
  printf '%-46s exit=%-3s pass=%-3s fail=%-3s %s\n' "$label" "$rc" "$p" "$fl" "$verdict"
done

{
  echo "================================================================"
  echo "PER-TICKET ACCEPTANCE EVIDENCE"
  echo "Generated : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Node      : $(node --version)"
  echo "================================================================"
  echo ""
  cat "$SUMMARY"
  echo ""
  echo "TOTAL: pass=$TOTAL_PASS fail=$TOTAL_FAIL"
  if [ ${#FAILED_FILES[@]} -eq 0 ]; then
    echo "RESULT: ALL TICKET FILES PROVEN (exit 0, zero failures)."
  else
    echo "RESULT: FAILURES IN: ${FAILED_FILES[*]}"
  fi
  echo ""
  echo "Raw per-file output: $OUT/*.raw.txt"
} > "$OUT/SUMMARY.txt"

echo ""
echo "TOTAL: pass=$TOTAL_PASS fail=$TOTAL_FAIL"
tail -4 "$OUT/SUMMARY.txt"
[ ${#FAILED_FILES[@]} -eq 0 ]
