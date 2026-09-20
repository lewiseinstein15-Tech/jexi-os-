#!/bin/sh
# JEXI OS — Phase 22 Scope D — SessionStart hook (superpowers pattern).
#
# POSIX-sh rendering of obra/superpowers hooks/session-start
# (MIT @ 5bf4e78011075bcfc0dc295f0724994cd123ee71).
#
# Same behaviour as upstream: read skills/using-superpowers/SKILL.md, wrap it
# in the EXTREMELY_IMPORTANT session-context envelope, and emit the single
# output field the detected platform consumes. Upstream is bash and uses
# ${var//old/new}; this rendering uses a sed-based escaper so /bin/sh runs it.

set -u

json_escape() {
  # Join all lines into one pattern space first, then escape. The join must
  # come first: substitutions applied before the N-loop only ever see line 1.
  printf '%s' "$1" | sed \
    -e ':a' -e 'N' -e '$!ba' \
    -e 's/\\/\\\\/g' \
    -e 's/"/\\"/g' \
    -e 's/\t/\\t/g' \
    -e 's/\r/\\r/g' \
    -e 's/\n/\\n/g'
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PLUGIN_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

SKILL_FILE="$PLUGIN_ROOT/skills/using-superpowers/SKILL.md"
if [ -f "$SKILL_FILE" ]; then
  using_superpowers_content=$(cat "$SKILL_FILE")
else
  using_superpowers_content="Error reading using-superpowers skill"
fi

body=$(json_escape "$using_superpowers_content")
session_context="<EXTREMELY_IMPORTANT>\\nYou have superpowers.\\n\\n**Below is the full content of your 'superpowers:using-superpowers' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\\n\\n${body}\\n</EXTREMELY_IMPORTANT>"

# Field selection mirrors upstream: Cursor wants additional_context,
# Claude Code wants the nested hookSpecificOutput form, Muse the nested form,
# everything else the SDK-standard top-level additionalContext.
if [ -n "${CURSOR_PLUGIN_ROOT:-}" ]; then
  printf '{\n  "additional_context": "%s"\n}\n' "$session_context"
elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -z "${COPILOT_CLI:-}" ] && [ -z "${MUSE_PLUGIN_ROOT:-}" ]; then
  printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$session_context"
elif [ -n "${MUSE_PLUGIN_ROOT:-}" ]; then
  printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$session_context"
else
  printf '{\n  "additionalContext": "%s"\n}\n' "$session_context"
fi

exit 0
