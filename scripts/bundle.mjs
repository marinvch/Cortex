#!/usr/bin/env node
/**
 * Bundle script: produces a single-file MCP server at dist/server.js
 * that can be deployed to target repos without node_modules.
 *
 * Usage: node scripts/bundle.mjs
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

await build({
  entryPoints: [path.join(root, 'src', 'mcp-server', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(root, 'dist', 'server.js'),
  banner: { js: '#!/usr/bin/env node\n// AI OS MCP Server — bundled single-file deployment' },
  external: ['@github/copilot-sdk'],
  // Mark built-in Node.js modules as external
  packages: 'external',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});

// Write a runtime manifest stub for the bundled server
const manifestPath = path.join(root, 'dist', 'bundle-manifest.json');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
fs.writeFileSync(manifestPath, JSON.stringify({
  bundledAt: new Date().toISOString(),
  sourceVersion: pkg.version,
  entryPoint: 'server.js',
  node: '>=20',
}, null, 2));

console.log(`\n✅ Bundle complete — dist/server.js (AI OS v${pkg.version})`);
console.log('   Deploy: copy dist/server.js to .ai-os/mcp-server/index.js in target repos');
