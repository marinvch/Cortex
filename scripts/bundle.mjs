#!/usr/bin/env node
/**
 * Bundle script: produces single-file bundles for deployment without node_modules.
 *   dist/server.js     — MCP server runtime used by install.sh
 *   bundle/server.js   — shipped MCP server bundle for npm/github package consumers
 *   bundle/generate.js — shipped CLI entrypoint used by `npx github:marinvch/ai-os`
 *
 * Usage: node scripts/bundle.mjs
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const distServerOutfile = path.join(root, 'dist', 'server.js');
const bundleServerOutfile = path.join(root, 'bundle', 'server.js');
const bundleGenerateOutfile = path.join(root, 'bundle', 'generate.js');

for (const outfile of [distServerOutfile, bundleServerOutfile]) {
  await build({
    entryPoints: [path.join(root, 'src', 'mcp-server', 'index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile,
    // Do NOT add #!/usr/bin/env node in banner — esbuild preserves the shebang
    // from src/mcp-server/index.ts automatically at position 1.
    banner: { js: '// AI OS MCP Server — bundled single-file deployment' },
    // @github/copilot-sdk is a dynamic import only loaded in --copilot mode.
    // Mark it external so the bundle runs cleanly without it in standalone mode.
    external: ['@github/copilot-sdk'],
    // Do NOT use packages:'external' — that would externalize ALL npm deps,
    // defeating the purpose of a self-contained bundle.
    minify: false,
    sourcemap: false,
    logLevel: 'info',
  });
}

await build({
  entryPoints: [path.join(root, 'src', 'generate.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: bundleGenerateOutfile,
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});

// Compute SHA-256 hash of the bundle for runtime-manifest integrity checks
const bundleHash = crypto.createHash('sha256').update(fs.readFileSync(distServerOutfile)).digest('hex');

// Write a runtime manifest stub for the bundled server
const manifestPath = path.join(root, 'dist', 'bundle-manifest.json');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
fs.writeFileSync(manifestPath, JSON.stringify({
  bundledAt: new Date().toISOString(),
  sourceVersion: pkg.version,
  entryPoint: 'server.js',
  sha256: bundleHash,
  node: '>=20',
}, null, 2));

console.log(`\n✅ Bundle complete — dist/server.js (AI OS v${pkg.version})`);
console.log(`   SHA-256: ${bundleHash}`);
console.log('   Deploy: copy dist/server.js to .ai-os/mcp-server/index.js in target repos');
console.log('   Ship: bundle/generate.js and bundle/server.js for npx/github consumers');
