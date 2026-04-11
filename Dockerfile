FROM node:20-alpine

WORKDIR /ai-os

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm install --prefer-offline --no-audit --no-fund --quiet

# Copy source
COPY . .

# Run the generator against a mounted target repo (/repo by default)
ENTRYPOINT ["node", "--import", "tsx/esm", "src/generate.ts"]
CMD ["--cwd", "/repo"]
