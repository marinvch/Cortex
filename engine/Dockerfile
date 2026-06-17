# AI OS — Docker image for Node.js-free installation
# Usage: docker run --rm -v "$(pwd):/repo" ghcr.io/marinvch/ai-os
# Or build locally:
#   docker build -t ai-os .
#   docker run --rm -v "$(pwd):/repo" ai-os

FROM node:20-alpine

WORKDIR /ai-os

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

# Copy source
COPY . .

# Default working directory for mounted target repo
WORKDIR /repo

ENTRYPOINT ["node", "--import", "tsx/esm", "/ai-os/src/generate.ts"]
CMD ["--cwd", "/repo"]
