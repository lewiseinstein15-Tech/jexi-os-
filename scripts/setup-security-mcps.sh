#!/usr/bin/env bash
# JEXI OS — setup-security-mcps.sh (FINAL GAP 2)
#
# Installs the underlying binaries for the seven wired security MCP bridges in
# server/mcp/servers/bin-bridge.js. Idempotent: every step is skipped when the
# binary is already present and healthy.
#
# Outcome per tool:
#   nmap       apt-get → source build (no root needed: --prefix=$HOME/.local)
#   semgrep    pip --user → uvx fallback
#   bandit     pip --user → uvx fallback
#   gitleaks   apt/brew → GitHub release binary → ~/.local/bin
#   subfinder  go install → GitHub release binary → ~/.local/bin
#   whatweb    apt-get → gem install (needs ruby; honest failure otherwise)
#   ghidra     NOT installed here (heavy JVM). Provision an external bridge:
#                export GHIDRA_HOST=https://<ghidra-bridge-host>
#              or docker: docker run --rm -p 8192:8192 ghidra/ghidra-bridge
#
# Usage:  bash scripts/setup-security-mcps.sh [tool ...]   (default: all)
set -uo pipefail

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
PATH="$BIN_DIR:$PATH"
export PATH

have() { command -v "$1" >/dev/null 2>&1; }

ok()   { printf '  [OK]   %s\n' "$1"; }
skip() { printf '  [SKIP] %s\n' "$1"; }
warn() { printf '  [WARN] %s\n' "$1"; }
die()  { printf '  [FAIL] %s\n' "$1"; }

install_nmap() {
  echo "== nmap =="
  if have nmap && nmap --version >/dev/null 2>&1; then ok "nmap $(nmap --version | grep -o 'version [0-9.]*' | head -1)"; return 0; fi
  if have apt-get && (apt-get install -y nmap >/dev/null 2>&1 || sudo -n apt-get install -y nmap >/dev/null 2>&1) && have nmap; then ok "nmap via apt"; return 0; fi
  if have gcc && have make && have curl; then
    local v=7.97 d="/tmp/nmap-build-$$"
    curl -sL -o /tmp/nmap.tgz "https://nmap.org/dist/nmap-${v}.tgz" || { die "download failed"; return 1; }
    mkdir -p "$d" && tar xzf /tmp/nmap.tgz -C "$d" --strip-components=1
    (cd "$d" && ./configure --prefix="$HOME/.local" --without-zenmap --without-ndiff --without-nmap-update \
       --with-libpcap=included --with-libpcre=included --with-libssh2=included --with-libz=included >/dev/null 2>&1 \
       && make -j4 >/dev/null 2>&1 && make install >/dev/null 2>&1) || { die "source build failed"; return 1; }
    have nmap && ok "nmap ${v} built from source → $BIN_DIR" && return 0
  fi
  die "nmap install failed (no apt, no toolchain)"; return 1
}

install_pip_tool() { # $1 name $2 extra
  echo "== $1 =="
  if have "$1" && "$1" --version >/dev/null 2>&1; then ok "$1 $("$1" --version 2>/dev/null | head -1 | grep -o '[0-9][0-9.]*' | head -1)"; return 0; fi
  if have pip3; then pip3 install --user --break-system-packages --quiet "$1" >/dev/null 2>&1; fi
  if have "$1"; then ok "$1 via pip --user"; return 0; fi
  if have uvx && uvx "$1" --version >/dev/null 2>&1; then ok "$1 via uvx"; return 0; fi
  die "$1 install failed (pip --user and uvx unavailable)"; return 1
}

install_gitleaks() {
  echo "== gitleaks =="
  if have gitleaks && gitleaks version >/dev/null 2>&1; then ok "gitleaks $(gitleaks version 2>/dev/null | head -1)"; return 0; fi
  if have apt-get && (apt-get install -y gitleaks >/dev/null 2>&1 || sudo -n apt-get install -y gitleaks >/dev/null 2>&1) && have gitleaks; then ok "gitleaks via apt"; return 0; fi
  if have curl; then
    curl -sL -o /tmp/gl.tgz "https://github.com/gitleaks/gitleaks/releases/download/v8.28.0/gitleaks_8.28.0_linux_x64.tar.gz" \
      && tar xzf /tmp/gl.tgz -C /tmp gitleaks && mv /tmp/gitleaks "$BIN_DIR/" || { die "release download failed"; return 1; }
    have gitleaks && ok "gitleaks 8.28.0 (release binary) → $BIN_DIR" && return 0
  fi
  die "gitleaks install failed"; return 1
}

install_subfinder() {
  echo "== subfinder =="
  if have subfinder && subfinder -version >/dev/null 2>&1; then ok "subfinder $(subfinder -version 2>/dev/null | grep -o 'v[0-9.]*' | head -1)"; return 0; fi
  if have go && go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest >/dev/null 2>&1 && have subfinder; then ok "subfinder via go install"; return 0; fi
  if have curl && have unzip; then
    curl -sL -o /tmp/sf.zip "https://github.com/projectdiscovery/subfinder/releases/download/v2.7.0/subfinder_2.7.0_linux_amd64.zip" \
      && unzip -o -q /tmp/sf.zip subfinder -d /tmp && mv /tmp/subfinder "$BIN_DIR/" || { die "release download failed"; return 1; }
    have subfinder && ok "subfinder 2.7.0 (release binary) → $BIN_DIR" && return 0
  fi
  die "subfinder install failed"; return 1
}

install_whatweb() {
  echo "== whatweb =="
  if have whatweb && whatweb --version >/dev/null 2>&1; then ok "whatweb $(whatweb --version 2>/dev/null | grep -o '[0-9][0-9.]*' | head -1)"; return 0; fi
  if have apt-get && (apt-get install -y whatweb >/dev/null 2>&1 || sudo -n apt-get install -y whatweb >/dev/null 2>&1) && have whatweb; then ok "whatweb via apt"; return 0; fi
  if have gem && gem install whatweb >/dev/null 2>&1 && have whatweb; then ok "whatweb via gem"; return 0; fi
  die "whatweb install failed (no apt / no ruby). The bridge stays CONNECTED and returns honest not-installed answers until a host provides it."; return 1
}

note_ghidra() {
  echo "== ghidra =="
  if [ -n "${GHIDRA_HOST:-}" ]; then ok "GHIDRA_HOST configured: ${GHIDRA_HOST}"; return 0; fi
  if [ -x /opt/ghidra/support/analyzeHeadless ]; then ok "local analyzeHeadless found"; return 0; fi
  warn "ghidra engine not provisioned (heavy JVM — intentionally not bundled)."
  echo "    Provision an external bridge and the wired tools use it automatically:"
  echo "      export GHIDRA_HOST=https://<ghidra-bridge-host>"
  echo "      docker run --rm -p 8192:8192 ghidra/ghidra-bridge"
  echo "    Until then ghidra_status answers for real and ghidra_decompile returns"
  echo "    an honest not-configured error (never a stub)."
  return 0
}

TOOLS="${*:-nmap semgrep bandit gitleaks subfinder whatweb ghidra}"
RC=0
for t in $TOOLS; do
  case "$t" in
    nmap) install_nmap || RC=1 ;;
    semgrep) install_pip_tool semgrep || RC=1 ;;
    bandit) install_pip_tool bandit || RC=1 ;;
    gitleaks) install_gitleaks || RC=1 ;;
    subfinder) install_subfinder || RC=1 ;;
    whatweb) install_whatweb || RC=1 ;;
    ghidra) note_ghidra || RC=1 ;;
    *) warn "unknown tool '$t'"; RC=1 ;;
  esac
done
echo ""
echo "NOTE: the bridges resolve binaries from PATH plus ~/.local/bin at CALL time."
echo "      After installing, verify through the gateway: scripts/mcp-state-test.mjs"
exit $RC
