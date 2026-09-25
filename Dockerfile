# Web se sestaví jako statický export, API ho servíruje — jeden kontejner, jeden port.
FROM node:24-slim AS web
WORKDIR /web
COPY Web/package.json Web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY Web/ ./
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production \
    WEB_DIR=/app/web \
    DATA_DIR=/data \
    DEFAULT_ROOT_DIR=/cloud \
    LISTEN_HOST=0.0.0.0 \
    PORT=8080
# ffmpeg = náhledy videí a covery hudby (bez něj appka ukazuje jen ikony)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Api/package.json Api/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY Api/src ./src
COPY --from=web /web/out ./web
EXPOSE 8080
# Node 24 spouští TypeScript přímo (type stripping), build API netřeba.
CMD ["node", "--disable-warning=ExperimentalWarning", "src/Server.ts"]
