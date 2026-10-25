FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
COPY model-lock.json ./
USER node
ENV PORT=7860 MODEL_CACHE_DIR=/tmp/slop-model-cache
EXPOSE 7860
CMD ["node", "dist/server.js"]
