#!/usr/bin/env node
/**
 * Assert the installer cannot talk to the network (R3).
 *
 * Two independent checks, because either alone is easy to defeat: a source grep for
 * network APIs, and a dependency-tree check. If someone adds an HTTP client later,
 * CI fails rather than shipping a tool that quietly phones home from inside a
 * company's repository.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED = ['src', 'bin', 'templates'];

const FORBIDDEN = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bnode:https?\b/, 'node:http/https'],
  [/from\s+['"]https?['"]/, "require('http'|'https')"],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bnode:dgram\b/, 'node:dgram'],
  [/\bnode:net\b/, 'node:net'],
  [/\baxios\b/, 'axios'],
  [/\bgot\(/, 'got()'],
  [/\bnode-fetch\b/, 'node-fetch'],
  [/undici/, 'undici'],
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (['.mjs', '.js', '.cjs'].includes(extname(abs))) out.push(abs);
  }
  return out;
}

const violations = [];

for (const rel of SCANNED) {
  let files;
  try {
    files = walk(join(ROOT, rel));
  } catch {
    continue;
  }
  for (const file of files) {
    const body = readFileSync(file, 'utf8');
    body.split('\n').forEach((line, i) => {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
      for (const [re, label] of FORBIDDEN) {
        if (re.test(line)) violations.push(`${file}:${i + 1} uses ${label}`);
      }
    });
  }
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const runtimeDeps = Object.keys(pkg.dependencies ?? {});
if (runtimeDeps.length) {
  violations.push(
    `package.json declares runtime dependencies (${runtimeDeps.join(', ')}); ` +
      'the installer must stay dependency-free so its egress surface is auditable',
  );
}

if (violations.length) {
  console.error('egress check FAILED:');
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log('egress check passed: no network APIs, no runtime dependencies');
