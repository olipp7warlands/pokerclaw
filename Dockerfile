FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies (includes devDeps for build tools)
COPY package.json package-lock.json ./
COPY packages/engine/package.json       packages/engine/
COPY packages/mcp-server/package.json   packages/mcp-server/
COPY packages/agents/package.json       packages/agents/
COPY packages/gateway/package.json      packages/gateway/
COPY packages/training/package.json     packages/training/
COPY packages/ui/package.json           packages/ui/
RUN npm ci

# Copy source and build everything
COPY . .
RUN npm run build

# ── Runtime image ──────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Copy only what's needed to run
COPY --from=builder /app/package.json          ./
COPY --from=builder /app/package-lock.json     ./
COPY --from=builder /app/node_modules          ./node_modules
COPY --from=builder /app/packages              ./packages
COPY --from=builder /app/scripts               ./scripts
COPY --from=builder /app/tsconfig.json         ./
COPY --from=builder /app/tsconfig.scripts.json ./

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "--import", "tsx/esm", "scripts/production.ts"]
