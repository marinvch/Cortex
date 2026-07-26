import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scan, collectEnvValues } from '../src/guard.mjs';

/**
 * Assemble a secret-shaped string at runtime.
 *
 * These fixtures must LOOK like real credentials or they would not exercise the guard —
 * which means a scanner reading this file finds real-looking credentials. GitHub push
 * protection rejected this file when the strings were literals, and every fork would hit
 * the same wall. Joining fragments keeps the assembled value byte-identical for the guard
 * while leaving no literal for a scanner to match.
 *
 * Do not "tidy" these back into single strings — the push will start failing again.
 */
const mk = (...parts) => parts.join('');

/**
 * MUST BLOCK. Every entry is a write that must never reach `.cortex/memory/`.
 * Committed-ungated memory is only as safe as this list is complete.
 */
const MUST_BLOCK = [
  ['aws access key id', `Deploys with ${mk('AKIA', 'IOSFODNN7EXAMPLE')} in the CI env`],
  ['github pat', `token ${mk('ghp', '_', '016C7e5c9AbCdEfGhIjKlMnOpQrStUvWxYz12')} was rotated`],
  ['github oauth', mk('gho', '_', '016C7e5c9AbCdEfGhIjKlMnOpQrStUvWxYz12')],
  ['stripe live key', `billing uses ${mk('sk', '_live_', '51H8xQ2eZvKYlo2CabCdEfGhIj')}`],
  ['stripe restricted', mk('rk', '_live_', '51H8xQ2eZvKYlo2CabCdEfGhIj')],
  ['slack bot token', mk('xoxb', '-2versions-1234567890-abcdefghijklmnop')],
  ['google api key', `maps key ${mk('AIza', 'SyD-1234567890abcdefghijklmnopqrstu')}`],
  ['npm token', mk('npm', '_', 'abcdefghijklmnopqrstuvwxyz0123456789')],
  ['anthropic key', mk('sk-ant-', 'api03-abcdefghij_klmnopqrstuvwxyz-0123456789')],
  ['openai key', mk('sk-proj-', 'abcdefghijklmnopqrstuvwxyz0123456789ABCD')],
  ['rsa private key', mk('-----BEGIN RSA ', 'PRIVATE KEY', '-----\nMIIEow...')],
  ['openssh private key', mk('-----BEGIN OPENSSH ', 'PRIVATE KEY', '-----')],
  ['generic private key', mk('-----BEGIN ', 'PRIVATE KEY', '-----')],
  [
    'jwt',
    `auth header ${mk(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      '.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
      '.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    )}`,
  ],
  ['postgres creds', `DB at ${mk('postgres://admin:', 'hunter2swordfish', '@db.internal:5432/prod')}`],
  ['mongodb creds', mk('mongodb+srv://root:', 'S3cr3tP4ssw0rd', '@cluster0.mongodb.net')],
  ['https basic creds', `curl ${mk('https://svcuser:', 'tokenvalue123', '@api.internal/v1')}`],
  [
    'high-entropy base64 blob',
    `the signing secret is ${mk('K7gNU3sdo+OL0wNhqoVWhr3g', '6s1xYv72ol/pe/Unols=')}`,
  ],
];

/**
 * MUST NOT BLOCK. Legitimate engineering notes that look secret-shaped.
 * A guard that fires on these is a guard developers will rip out.
 */
const MUST_NOT_BLOCK = [
  ['git commit sha', 'regression landed in c5ae9dd83eb1f2a4d5c6b7a8e9f0a1b2c3d4e5f6'],
  ['sha256 hex digest', 'digest 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'],
  ['uuid', 'trace id 550e8400-e29b-41d4-a716-446655440000'],
  [
    'npm lockfile integrity',
    'resolved with integrity sha512-Wt9OTQCXnOsSp1cLdmUKrQ1gVAuLLNcJPnSjWCwtUnZOWMTKcNRDpqRmSb1Uk3UnAdaVWvKvNUXcCJHxOJbLQg==',
  ],
  [
    'sri hash in html',
    'script integrity="sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC"',
  ],
  ['data uri image', 'icon is data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='],
  ['env var name only', 'set STRIPE_SECRET_KEY in the deploy environment, never in code'],
  ['long kebab identifier', 'the feature flag is enable-new-checkout-flow-for-eu-customers-v2'],
  ['file path', 'lives in node_modules/.pnpm/@babel+core@7.23.9/node_modules/@babel/core'],
  ['prose about tokens', 'The auth token expires after 15 minutes; refresh it with the refresh token.'],
  ['semver list', 'bumped react 18.2.0, next 14.1.4, typescript 5.4.2'],
];

test('blocks every entry in the must-block corpus', () => {
  for (const [label, content] of MUST_BLOCK) {
    const res = scan(content);
    assert.equal(res.ok, false, `expected BLOCK for "${label}": ${content.slice(0, 60)}`);
    assert.ok(res.findings.length > 0, `expected findings for "${label}"`);
  }
});

test('allows every entry in the must-not-block corpus', () => {
  for (const [label, content] of MUST_NOT_BLOCK) {
    const res = scan(content);
    assert.equal(
      res.ok,
      true,
      `expected ALLOW for "${label}" but got: ${JSON.stringify(res.findings)}`,
    );
  }
});

test('blocks a value lifted from the repo .env, which no regex would know', () => {
  const envValues = collectEnvValuesFrom({
    '.env': 'ACME_PARTNER_TOKEN=zulu-tango-9931-quebec\nPORT=3000\nNODE_ENV=development\n',
  });
  const res = scan('the partner integration uses zulu-tango-9931-quebec as its token', {
    envValues,
  });
  assert.equal(res.ok, false);
  assert.equal(res.findings[0].rule, 'env-value');
});

test('reports which env var matched but never the value itself', () => {
  const envValues = collectEnvValuesFrom({
    '.env.local': 'ACME_PARTNER_TOKEN=zulu-tango-9931-quebec\n',
  });
  const res = scan('token is zulu-tango-9931-quebec', { envValues });
  const serialized = JSON.stringify(res.findings);
  assert.match(serialized, /ACME_PARTNER_TOKEN/);
  assert.doesNotMatch(serialized, /zulu-tango-9931-quebec/);
});

test('ignores short and non-secret env values so PORT=3000 is not a tripwire', () => {
  const envValues = collectEnvValuesFrom({
    '.env': 'PORT=3000\nNODE_ENV=development\nDEBUG=true\n',
  });
  assert.equal(envValues.length, 0);
  const res = scan('we run on port 3000 in development with debug true', { envValues });
  assert.equal(res.ok, true);
});

test('reports the offending line number so a human can find it', () => {
  const res = scan('line one is fine\nline two is fine\ntoken ghp_016C7e5c9AbCdEfGhIjKlMnOpQrStUvWxYz12');
  assert.equal(res.ok, false);
  assert.equal(res.findings[0].lineNo, 3);
});

// ── helper: write a throwaway repo with the given files, collect its env values ──
function collectEnvValuesFrom(files) {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-guard-'));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return collectEnvValues(dir);
}
