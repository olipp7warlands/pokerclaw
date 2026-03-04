FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/engine/package.json       packages/engine/
COPY packages/mcp-server/package.json   packages/mcp-server/
COPY packages/agents/package.json       packages/agents/
COPY packages/training/package.json     packages/training/
COPY packages/gateway/package.json      packages/gateway/
COPY packages/ui/package.json           packages/ui/

RUN npm ci

COPY . .
RUN npm run build

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

COPY --from=builder /app .

EXPOSE 3000
ENV NODE_ENV=production

CMD ["npm", "run", "start"]
