# JEXI OS — single-container image (Hugging Face Spaces / Docker / VPS)
# - Runs the Express "brain" (chat API, agents, memory, terminal)
# - Installs Chromium + system libs AS ROOT during build -> JEXI's eyes work
# - Builds the frontend into server/public so the whole app lives on ONE host
#
# Hugging Face Spaces (free, no credit card): create a Space with SDK "Docker"
# and push this repo — HF runs this Dockerfile as root, so everything installs.

FROM node:22-slim

# Chromium system dependencies (Playwright — JEXI's eyes)
# ── Optional heavy tooling — OFF by default (see server/Dockerfile) ─────────
# INSTALL_BROWSER=1 → Chromium system libs (JEXI's eyes on this image).
# INSTALL_MEDIA=1   → ffmpeg + python3/pip + yt-dlp (/watch URL path).
# Full-featured build:
#   docker build --build-arg INSTALL_BROWSER=1 --build-arg INSTALL_MEDIA=1 .
ARG INSTALL_BROWSER=0
ARG INSTALL_MEDIA=0
RUN PKGS="ca-certificates fonts-liberation"; \
    if [ "$INSTALL_BROWSER" = "1" ]; then PKGS="$PKGS libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libglib2.0-0 libx11-6 libx11-xcb1 libxext6 libxi6 libxtst6 libxrender1 libxss1"; fi; \
    if [ "$INSTALL_MEDIA" = "1" ]; then PKGS="$PKGS ffmpeg python3 python3-pip"; fi; \
    apt-get update && apt-get install -y --no-install-recommends $PKGS \
    && rm -rf /var/lib/apt/lists/* \
    && if [ "$INSTALL_MEDIA" = "1" ]; then (pip3 install --no-cache-dir --break-system-packages yt-dlp \
        || pip3 install --no-cache-dir yt-dlp \
        || echo 'WARN: yt-dlp install failed - /watch URL downloads disabled on this image'); else echo 'INSTALL_MEDIA=0 - skipping yt-dlp (VideoWatch degrades honestly)'; fi

WORKDIR /app

# Backend dependencies + Chromium download (runs as root inside Docker).
# PLAYWRIGHT_BROWSERS_PATH=0 keeps browsers inside node_modules (persist to runtime).
COPY server/package*.json ./server/
RUN cd server && npm ci --no-audit --no-fund \
    && if [ "$INSTALL_BROWSER" = "1" ]; then (PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install --with-deps chromium || echo "playwright chromium install failed — browser mode degrades"); else echo "INSTALL_BROWSER=0 — skipping Chromium (set the build arg to restore JEXI's eyes)"; fi
COPY server ./server
# mcp/ lives INSIDE server/ since the f5659d0 layout move (shipped by the
# COPY server line above; kept explicit here so the registry is never lost).
COPY server/mcp ./server/mcp
ENV PLAYWRIGHT_BROWSERS_PATH=0

# Frontend build -> served from server/public by Express
COPY package*.json index.html vite.config.js tailwind.config.js postcss.config.js ./
# ── Boot-chain trees (same set as Dockerfile.slim) ─────────────────────────
# server/index.js -> src/wiring/phase31-bootstrap.js statically imports these
# trees via ../..; ESM link fails before app.listen() if any is missing.
COPY interfaces ./interfaces
COPY capabilities ./capabilities
COPY runtime ./runtime
COPY integrations ./integrations
COPY agents ./agents
COPY mind ./mind
COPY harness ./harness
COPY services ./services
COPY skills ./skills
COPY security ./security
COPY tests ./tests
RUN npm ci --no-audit --no-fund && npm run build
# server/public is a git symlink to ../dist — vite writes the bundle
# straight through it, so the old `cp -r dist/* server/public/` copied
# dist onto ITSELF and failed with "are the same file".

ENV NODE_ENV=production
# Hugging Face injects PORT=7860; this is the default everywhere else too.
ENV PORT=7860
# Attach an HF Storage Bucket at /data (or a Docker volume) so JEXI's memory survives.
ENV DATA_DIR=/data
ENV WORKSPACE_DIR=/data/workspace
EXPOSE 7860

WORKDIR /app/server
CMD ["node", "index.js"]
