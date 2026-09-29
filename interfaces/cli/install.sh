#!/usr/bin/env bash
# JEXI — laptop installer (Linux / macOS).
#
#   curl -fsSL https://raw.githubusercontent.com/lewiseinstein15-Tech/jexi-os-/main/cli/install.sh | bash
#
# Installs: ~/.jexi/repo (this repo) + backend deps + `jexi` on PATH.
# Then: jexi init
set -euo pipefail

REPO_URL="${JEXI_REPO_URL:-https://github.com/lewiseinstein15-Tech/jexi-os-.git}"
DEST="${HOME}/.jexi/repo"
BIN_DIR="${HOME}/.local/bin"

say() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "node not found — install Node.js 20+ (https://nodejs.org), then re-run."
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
[ "${NODE_MAJOR}" -ge 20 ] || fail "node $(node --version) is too old — JEXI needs Node.js 20+."
command -v git >/dev/null 2>&1 || fail "git not found — install git, then re-run."
command -v npm >/dev/null 2>&1 || fail "npm not found — install npm (ships with Node.js), then re-run."

if [ -d "${DEST}/.git" ]; then
  say "Updating ${DEST}…"
  git -C "${DEST}" pull --ff-only || say "(keeping existing checkout)"
else
  say "Cloning JEXI into ${DEST}…"
  mkdir -p "${HOME}/.jexi"
  git clone --depth 1 "${REPO_URL}" "${DEST}"
fi

say "Installing backend dependencies…"
(cd "${DEST}/server" && npm ci --no-audit --no-fund)

say "Installing browser (best-effort — JEXI works without it, degraded)…"
(cd "${DEST}/server" && PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium || true) >/dev/null 2>&1 || true

mkdir -p "${BIN_DIR}"
ln -sf "${DEST}/cli/jexi.js" "${BIN_DIR}/jexi"
chmod +x "${DEST}/cli/jexi.js"

say ""
say "Installed. Next:"
say "  1) Ensure ${BIN_DIR} is on your PATH (open a NEW terminal, or: export PATH=\"\$HOME/.local/bin:\$PATH\")"
say "  2) jexi init        # provider + API key + model"
say "  3) jexi \"build …\"  # work in the current directory"
