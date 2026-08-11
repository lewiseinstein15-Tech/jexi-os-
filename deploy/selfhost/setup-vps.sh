#!/usr/bin/env bash
# ============================================================
# JEXI OS Brain — single-user VPS installer (Debian / Ubuntu)
# Run as root on a fresh $4-6/mo VPS:
#   bash <(curl -fsSL https://raw.githubusercontent.com/lewiseinstein15-Tech/jexi-os-/main/deploy/selfhost/setup-vps.sh)
# or copy this file up and run:  sudo bash setup-vps.sh
# ============================================================
set -euo pipefail

APP_NAME="jexi-os-brain"
APP_DIR="/opt/${APP_NAME}"          # code lives here
DATA_DIR="/var/lib/${APP_NAME}"     # memory + knowledge persist here (never wiped)
SERVICE_USER="jexi"
REPO_URL="${REPO_URL:-https://github.com/lewiseinstein15-Tech/jexi-os-.git}"
NODE_MAJOR=22

echo "==> JEXI OS self-host installer"

# --- 1. Base packages -------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends curl ca-certificates git build-essential \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libasound2 libpango-1.0-0 libcairo2 libglib2.0-0 libx11-6 libx11-xcb1 \
  libxext6 libxi6 libxtst6 libxrender1 libxss1 ca-certificates fonts-liberation

# --- 2. Node 22 (NodeSource) ------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
echo "   node: $(node -v)"

# --- 3. App user + directories ----------------------------------------------
id -u ${SERVICE_USER} >/dev/null 2>&1 || useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin ${SERVICE_USER}
mkdir -p "${APP_DIR}" "${DATA_DIR}/workspace" "${DATA_DIR}/books" "${DATA_DIR}/knowledge"
chown -R ${SERVICE_USER}:${SERVICE_USER} "${APP_DIR}" "${DATA_DIR}"

# --- 4. Code + dependencies --------------------------------------------------
if [ ! -f "${APP_DIR}/server/package.json" ]; then
  echo "==> Cloning repo into ${APP_DIR}"
  git clone --depth 1 "${REPO_URL}" "${APP_DIR}"
  chown -R ${SERVICE_USER}:${SERVICE_USER} "${APP_DIR}"
fi
cd "${APP_DIR}/server"
sudo -u ${SERVICE_USER} npm ci --omit=dev 2>/dev/null || sudo -u ${SERVICE_USER} npm ci
echo "==> Installing Chromium for the Computer-Use / QA agents (one time)"
sudo -u ${SERVICE_USER} env PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium || true

# --- 5. Env file (edit this with your keys) -----------------------------------
ENV_FILE="/etc/jexi-os.env"
if [ ! -f "${ENV_FILE}" ]; then
  cat > "${ENV_FILE}" <<EOF
# JEXI OS Brain environment — edit with:  sudo nano /etc/jexi-os.env
# Then:  sudo systemctl restart ${APP_NAME}
PORT=3002
DATA_DIR=${DATA_DIR}
WORKSPACE_DIR=${DATA_DIR}/workspace
PLAYWRIGHT_BROWSERS_PATH=0
# --- your keys (at least ONE AI key) ---
# GROQ_API_KEY=your_groq_key
# GEMINI_API_KEY=your_gemini_key
# --- optional hardening ---
# JEXI_API_KEY=your_secret_passphrase
# CORS_ORIGINS=https://lewiseinstein15-Tech.github.io
# REDIS_URL=rediss://...
EOF
  chmod 600 "${ENV_FILE}"
  echo "==> Created ${ENV_FILE} — ADD YOUR KEYS, then restart the service."
fi

# --- 6. systemd unit ----------------------------------------------------------
NODE_BIN="$(command -v node)"
cat > "/etc/systemd/system/${APP_NAME}.service" <<EOF
[Unit]
Description=JEXI OS Brain — multi-agent AI operating system (single user)
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}/server
ExecStart=${NODE_BIN} index.js
Restart=always
RestartSec=3
EnvironmentFile=${ENV_FILE}
# Crash-proof: if the process dies for any reason systemd brings it right back.
# Memory ceiling — restart cleanly instead of the OS OOM-killing randomly.
MemoryMax=1536M

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${APP_NAME}"
systemctl start "${APP_NAME}" || { echo "!! Service failed to start — see: journalctl -u ${APP_NAME} -n 50"; exit 1; }

# --- 7. Verify ----------------------------------------------------------------
sleep 2
echo ""
echo "==============================================================="
echo " JEXI OS Brain is LIVE — no hibernation, no cold starts."
curl -s -m 5 "http://127.0.0.1:3002/api/health" && echo
echo ""
echo " Useful commands:"
echo "   sudo systemctl status ${APP_NAME}     # is it running"
echo "   sudo journalctl -u ${APP_NAME} -f     # live logs"
echo "   sudo nano /etc/jexi-os.env            # add your AI keys"
echo "   sudo systemctl restart ${APP_NAME}    # apply"
echo "==============================================================="
