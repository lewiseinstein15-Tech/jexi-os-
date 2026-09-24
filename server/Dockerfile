# JEXI OS brain — runtime image (Suga, node 22)
# Build context is the REPO ROOT (see .github/workflows/docker-image.yml) so the
# image can ship the same layout the sources expect: server/ at /app/server and
# the boot-chain trees at /app/<tree>. server/src/... resolves them via `../..`
# (up to /app); with the old context=server/ layout the server tree sat at /app
# and every such import escaped to /<tree>, crashing ESM link at boot.
FROM node:22-bookworm-slim

RUN apt-get update -qq \
  && (apt-get install -y -qq ffmpeg ca-certificates curl || echo "apt ffmpeg/curl failed — /watch degrades to captions-only") \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

ENV PLAYWRIGHT_BROWSERS_PATH=0
RUN cd server && (npx playwright install --with-deps chromium || npx playwright install chromium || echo "playwright chromium install failed — browser mode degrades")

# ── App tree + boot-chain trees (repo layout mirrored, as in Dockerfile.slim) ─
COPY server ./server
COPY mind ./mind
COPY runtime ./runtime
COPY harness ./harness
COPY services ./services
COPY capabilities ./capabilities
COPY agents ./agents
COPY integrations ./integrations
COPY skills ./skills
COPY security ./security
COPY tests ./tests
COPY interfaces ./interfaces

RUN mkdir -p /app/bin \
  && (curl -fsSL --fail -o bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
      && chmod +x bin/yt-dlp || echo "yt-dlp download failed — /watch URL mode degrades")
ENV PATH="/app/bin:${PATH}"

EXPOSE 3002

# 256Mi hobby-pool survival (Suga): the app boots at ~199MB RSS and dies the
# moment (a) registerDesktopWorker() launches Chromium (+150-250MB) or (b) MCP
# boot-connect spawns stdio children (~40-90MB each). Both are the app's own
# designed small-host degradations — they wake lazily (or not at all) and can
# be re-enabled by removing these flags on a bigger plan.
ENV JEXI_NO_BROWSER=1 \
    JEXI_MCP_MINIMAL=1

# Run node DIRECTLY — `npm start` keeps the npm process resident (~60-80MB RSS)
# for the container's whole lifetime, which alone blows the 256Mi hobby pool.
# package.json "start" is exactly `node index.js`, so this is 1:1 minus npm.
WORKDIR /app/server
CMD ["node", "index.js"]
