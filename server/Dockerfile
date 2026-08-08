# JEXI OS Backend — Docker image (for Render "Docker" runtime, or any VPS)
# Build: docker build -f server/Dockerfile -t jexi-os-brain server
FROM node:22-slim

# Chromium system dependencies (playwright)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libasound2 libpango-1.0-0 libcairo2 libglib2.0-0 libx11-6 libx11-xcb1 \
    libxext6 libxi6 libxtst6 libxrender1 libxss1 \
    ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node deps first (better layer caching)
COPY package*.json ./
# Browsers inside node_modules so they survive to runtime (PLAYWRIGHT_BROWSERS_PATH=0)
RUN npm ci && PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium
ENV PLAYWRIGHT_BROWSERS_PATH=0

# Copy the backend source
COPY index.js ./
COPY src ./src

ENV NODE_ENV=production
# Render injects PORT (default 10000); server falls back to 3002 locally
EXPOSE 10000

CMD ["node", "index.js"]
