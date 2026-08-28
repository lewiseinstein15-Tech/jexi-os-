# JEXI OS — single-container image (Hugging Face Spaces / Docker / VPS)
# - Runs the Express "brain" (chat API, agents, memory, terminal)
# - Installs Chromium + system libs AS ROOT during build -> JEXI's eyes work
# - Builds the frontend into server/public so the whole app lives on ONE host
#
# Hugging Face Spaces (free, no credit card): create a Space with SDK "Docker"
# and push this repo — HF runs this Dockerfile as root, so everything installs.

FROM node:22-slim

# Chromium system dependencies (Playwright — JEXI's eyes)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libasound2 libpango-1.0-0 libcairo2 libglib2.0-0 libx11-6 libx11-xcb1 \
    libxext6 libxi6 libxtst6 libxrender1 libxss1 \
    ca-certificates fonts-liberation \
    # B167 — /watch (video): ffmpeg for frames/audio + pip for yt-dlp
    ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir yt-dlp || (curl -L https://github.com/yt-dlp/yt-dlp/raw/master/yt-dlp -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp)

WORKDIR /app

# Backend dependencies + Chromium download (runs as root inside Docker).
# PLAYWRIGHT_BROWSERS_PATH=0 keeps browsers inside node_modules (persist to runtime).
COPY server/package*.json ./server/
RUN cd server && npm ci --no-audit --no-fund && PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install --with-deps chromium
COPY server ./server
ENV PLAYWRIGHT_BROWSERS_PATH=0

# Frontend build -> served from server/public by Express
COPY package*.json index.html vite.config.js tailwind.config.js postcss.config.js ./
COPY public ./public
COPY src ./src
RUN npm ci --no-audit --no-fund && npm run build && mkdir -p server/public && cp -r dist/* server/public/

ENV NODE_ENV=production
# Hugging Face injects PORT=7860; this is the default everywhere else too.
ENV PORT=7860
# Attach an HF Storage Bucket at /data (or a Docker volume) so JEXI's memory survives.
ENV DATA_DIR=/data
ENV WORKSPACE_DIR=/data/workspace
EXPOSE 7860

WORKDIR /app/server
CMD ["node", "index.js"]
