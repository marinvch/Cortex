# AI OS Generator — Docker image
# Allows running AI OS on repositories without Node.js installed on the host.
#
# Build:
#   docker build -t ai-os .
#
# Run (from inside the target repository):
#   docker run --rm -v "$(pwd):/repo" ai-os
#
# Run with refresh:
#   docker run --rm -v "$(pwd):/repo" ai-os --refresh-existing

FROM node:20-alpine

LABEL org.opencontainers.image.title="AI OS"
LABEL org.opencontainers.image.description="Portable GitHub Copilot context engine — scan any repo and generate optimized AI context"
LABEL org.opencontainers.image.source="https://github.com/marinvch/ai-os"
LABEL org.opencontainers.image.version="0.5.0"

WORKDIR /ai-os

# Copy source and install dependencies
COPY package*.json ./
RUN npm install --prefer-offline --no-audit --no-fund --silent

COPY . .

# The target repository is expected to be mounted at /repo
VOLUME ["/repo"]

ENTRYPOINT ["node", "--import", "tsx/esm", "src/generate.ts", "--cwd", "/repo"]
CMD []
