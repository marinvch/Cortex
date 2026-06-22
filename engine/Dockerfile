# Cortex — Docker image for Node.js-free installation
# Usage: docker run --rm -v "$(pwd):/repo" ghcr.io/marinvch/cortex
# Or build locally:
#   docker build -t cortex .
#   docker run --rm -v "$(pwd):/repo" cortex

FROM node:20-alpine

WORKDIR /cortex

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

# Copy source
COPY . .

# Default working directory for mounted target repo
WORKDIR /repo

ENTRYPOINT ["node", "--import", "tsx/esm", "/cortex/src/generate.ts"]
CMD ["--cwd", "/repo"]
