#!/usr/bin/env node
/**
 * Bundle script: produces single-file bundles for deployment without node_modules.
 *   dist/server.js   — MCP server (deploy to .ai-os/mcp-server/index.js)
 *   dist/generate.js — Context generator (used by install.sh when present)
 *
 * Usage: node scripts/bundle.mjs
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// ── MCP server bundle ────────────────────────────────────────────────────────
await build({
  entryPoints: [path.join(root, 'src', 'mcp-server', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(root, 'bundle', 'server.js'),
  // Source file already has #!/usr/bin/env node — no banner needed
  external: ['@github/copilot-sdk'],
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});

// ── Generator bundle ─────────────────────────────────────────────────────────
await build({
  entryPoints: [path.join(root, 'src', 'generate.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(root, 'bundle', 'generate.js'),
  // Source file already has #!/usr/bin/env node — no banner needed
  // Mark built-in Node.js modules as external
  packages: 'external',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});

// Write a runtime manifest stub for the bundles
const manifestPath = path.join(root, 'bundle', 'bundle-manifest.json');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
fs.writeFileSync(manifestPath, JSON.stringify({
  bundledAt: new Date().toISOString(),
  sourceVersion: pkg.version,
  entryPoints: {
    server: 'server.js',
    generator: 'generate.js',
  },
  node: '>=20',
}, null, 2));

console.log(`\n✅ Bundle complete — AI OS v${pkg.version}`);
console.log('   bundle/server.js   → deploy to .ai-os/mcp-server/index.js in target repos');
console.log('   bundle/generate.js → used by install.sh when present (no npm install needed)');
