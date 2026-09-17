# JEXI OS brain — server/ runtime image (Suga, node 22)
# Replicates the Render buildCommand/startCommand 1:1.
FROM node:22-bookworm-slim

RUN apt-get update -qq \
  && (apt-get install -y -qq ffmpeg ca-certificates curl || echo "apt ffmpeg/curl failed — /watch degrades to captions-only") \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

ENV PLAYWRIGHT_BROWSERS_PATH=0
RUN (npx playwright install --with-deps chromium || npx playwright install chromium || echo "playwright chromium install failed — browser mode degrades")

COPY . .

RUN mkdir -p bin \
  && (curl -fsSL --fail -o bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
      && chmod +x bin/yt-dlp || echo "yt-dlp download failed — /watch URL mode degrades")
ENV PATH="/app/bin:${PATH}"

EXPOSE 3002
CMD ["npm", "start"]
