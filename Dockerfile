# =============================================================================
#  AI OS — Docker image for running the generator without a local Node.js install
#
#  Usage (from inside the target repository):
#    docker build -t ai-os https://github.com/marinvch/ai-os.git#master
#    docker run --rm -v "$(pwd):/repo" ai-os --cwd /repo
#
#  Or via bootstrap.sh (detects Docker automatically when Node.js is absent).
# =============================================================================

FROM node:20-slim AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

# Copy source
COPY . .

# Build TypeScript and create the bundled MCP server
RUN npm run build && node scripts/bundle.mjs

# ── Runtime image ────────────────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Copy built artifacts and runtime dependencies only
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/scripts ./scripts

# /repo is mounted by the caller (the target repository)
VOLUME ["/repo"]

ENTRYPOINT ["node", "--import", "tsx/esm", "src/generate.ts"]
CMD ["--cwd", "/repo"]
