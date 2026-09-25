# Build context: repo root
# Single image: Scrapling (PRIMARY) + Node API. No Playwright browsers (CRAWLER=scrapling).

FROM node:22-bookworm-slim AS node-deps
WORKDIR /app/backend
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM ghcr.io/astral-sh/uv:0.9-python3.12-bookworm-slim AS py-deps
WORKDIR /app/scraper
COPY scraper/pyproject.toml scraper/uv.lock ./
COPY scraper/README.md ./README.md
COPY scraper/src ./src
RUN uv sync --frozen --no-dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv

WORKDIR /app
COPY shared ./shared
COPY --from=node-deps /app/backend/node_modules ./backend/node_modules
COPY backend/package.json backend/package-lock.json ./backend/
COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/tsconfig.json
COPY --from=py-deps /app/scraper /app/scraper
COPY scripts/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    CRAWLER=scrapling \
    SCRAPLING_URL=http://127.0.0.1:4100 \
    SCRAPER_HOST=127.0.0.1 \
    SCRAPER_PORT=4100 \
    PORT=4000 \
    HOST=0.0.0.0 \
    MALLOC_ARENA_MAX=2 \
    PYTHONUNBUFFERED=1

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/health || exit 1

CMD ["/entrypoint.sh"]
