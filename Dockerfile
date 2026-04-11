# AI OS — Docker image for Node.js-free installs
# Allows `install.sh` to generate Copilot context files without requiring
# Node.js to be installed on the host machine.
#
# Usage (via install.sh — automatic):
#   bash install.sh --cwd /path/to/your/repo
#
# Manual usage:
#   docker build -t ai-os-local .
#   docker run --rm -v "$(pwd):/repo" ai-os-local --cwd /repo
#
# To refresh existing artifacts:
#   docker run --rm -v "$(pwd):/repo" ai-os-local --cwd /repo --refresh-existing

FROM node:20-alpine

WORKDIR /ai-os

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm install --prefer-offline --no-audit --no-fund

# Copy source and build
COPY . .
RUN npm run build

# Default entry point: the compiled generator
ENTRYPOINT ["node", "dist/generate.js"]
