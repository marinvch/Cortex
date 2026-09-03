import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Namespace import on purpose. A missing named export is a link-time error that takes the
// whole file down with one opaque message; reading off the namespace lets the meta-test
// below say exactly which part of the guard's contract is missing.
import * as guard from '../src/guard.mjs';
import { appendGotchas, GOTCHAS } from '../src/memory.mjs';

const { scan, collectEnvValues } = guard;

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
 * A Slack incoming webhook, assembled rather than written out for exactly the reason above —
 * GitHub push protection recognises this shape and rejects the push. It appears twice below:
 * once as a corpus entry, once in the test pinning the limit of the layer-3 URL exemption.
 */
const SLACK_WEBHOOK = mk(
  'https://hooks.',
  'slack.com',
  '/services/T00000000',
  '/B00000000',
  '/XoXoXoXoXoXoXoXoXoXoXoXo',
);

/**
 * One corpus entry.
 *
 * @param label  the class of secret this exercises, for the failure message
 * @param rule   the rule name the guard must emit for it — the meta-test below is built
 *               on this, so a new rule with no entry naming it fails CI
 * @param content what a session might try to append to `.cortex/memory/`
 * @param env    body of a `.env` file to harvest first, for layer-3 entries
 */
const blocks = (label, rule, content, env) => ({ label, rule, content, env });
const allows = (label, content, env) => ({ label, content, env });

/**
 * MUST BLOCK. Every entry is a write that must never reach `.cortex/memory/`.
 * Committed-ungated memory is only as safe as this list is complete.
 */
const MUST_BLOCK = [
  // ── layer 1: known key shapes ──────────────────────────────────────────────
  blocks('aws access key id', 'aws-access-key-id', `Deploys with ${mk('AKIA', 'IOSFODNN7EXAMPLE')} in the CI env`),
  blocks('github pat', 'github-token', `token ${mk('ghp', '_', '016C7e5c9AbCdEfGhIjKlMnOpQrStUvWxYz12')} was rotated`),
  blocks('github oauth', 'github-token', mk('gho', '_', '016C7e5c9AbCdEfGhIjKlMnOpQrStUvWxYz12')),
  blocks('github server-to-server', 'github-token', `the app installs with ${mk('ghs', '_', '016C7e5c9AbCdEfGhIjKlMnOpQrStUvWxYz12')}`),
  blocks('stripe live key', 'stripe-key', `billing uses ${mk('sk', '_live_', '51H8xQ2eZvKYlo2CabCdEfGhIj')}`),
  blocks('stripe restricted', 'stripe-key', mk('rk', '_live_', '51H8xQ2eZvKYlo2CabCdEfGhIj')),
  blocks('slack bot token', 'slack-token', mk('xoxb', '-2versions-1234567890-abcdefghijklmnop')),
  blocks('slack user token', 'slack-token', `posting as me with ${mk('xoxp', '-1234567890-1234567890-1234567890-abcdefghijklmnopqrstuvwxyz012345')}`),
  blocks('google api key', 'google-api-key', `maps key ${mk('AIza', 'SyD-1234567890abcdefghijklmnopqrstu')}`),
  blocks('npm token', 'npm-token', mk('npm', '_', 'abcdefghijklmnopqrstuvwxyz0123456789')),
  blocks('anthropic key', 'anthropic-key', mk('sk-ant-', 'api03-abcdefghij_klmnopqrstuvwxyz-0123456789')),
  blocks('openai key', 'openai-key', mk('sk-proj-', 'abcdefghijklmnopqrstuvwxyz0123456789ABCD')),
  blocks('rsa private key', 'private-key-block', mk('-----BEGIN RSA ', 'PRIVATE KEY', '-----\nMIIEow...')),
  blocks('openssh private key', 'private-key-block', mk('-----BEGIN OPENSSH ', 'PRIVATE KEY', '-----')),
  blocks('generic private key', 'private-key-block', mk('-----BEGIN ', 'PRIVATE KEY', '-----')),
  blocks(
    'jwt',
    'jwt',
    `auth header ${mk(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      '.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
      '.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    )}`,
  ),

  // ── layer 1: prefixed keys the first corpus never named ────────────────────
  blocks(
    'stripe webhook signing secret',
    'stripe-webhook-secret',
    `verify the payload against ${mk('whsec', '_', 'Xy9KqL2mNpR4sT6vW8zA1bC3dE5fG7hJ')}`,
  ),
  blocks('gitlab personal access token', 'gitlab-token', `mirror pulls with ${mk('glpat', '-', 'ZyXwVuTsRqPoNmLkJiHg')}`),
  blocks(
    'slack app-level token',
    'slack-app-token',
    `socket mode needs ${mk('xapp', '-1-', 'A01BCDEFGHI-1234567890123-abcdef0123456789abcdef0123456789abcdef0123456789')}`,
  ),
  blocks(
    'digitalocean personal token',
    'digitalocean-token',
    `doctl authenticated with ${mk('dop_v1_', '9f2c1a7d3b5e8046a1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f6071829')}`,
  ),
  blocks(
    'sendgrid api key',
    'sendgrid-key',
    `transactional mail goes out under ${mk('SG.', 'Xy9KqL2mNpR4sT6vW8zA1b', '.', 'C3dE5fG7hJ8kL0mN2pQ4rS6tU8vW0xY2zA4bC6dE8fG')}`,
  ),
  blocks('figma personal token', 'figma-token', `design tokens sync via ${mk('figd', '_', 'Xy9KqL2mNpR4sT6vW8zA1bC3dE5fG7hJ8kL0mN2p')}`),
  blocks('huggingface token', 'huggingface-token', `the model download used ${mk('hf', '_', 'XyKqLmNpRsTvWzAbCdEfGhIjKlMnOpQrSt')}`),
  blocks(
    'atlassian api token',
    'atlassian-token',
    `jira sync runs as ${mk('ATATT', '3xFfGF0', 'T5m8kQ2wXyZ1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789ABCDEF')}`,
  ),
  blocks('twilio account sid', 'twilio-account-sid', `sms sends from account ${mk('AC', '1a2b3c4d5e6f70819a0b1c2d3e4f5061')}`),

  // ── hex-encoded secrets: 64 hex chars sit at ~4.0 bits/char, so layer 4 at the
  // 4.5 threshold D7 fixes in place provably cannot reach them. Only a key name
  // beside a long hex run separates these from a commit SHA. ──────────────────
  blocks(
    'rails secret_key_base',
    'secret-adjacent-hex',
    `credentials.yml.enc holds secret_key_base: ${mk(
      '3f9a1c7e5b2d8046',
      'a1c2d3e4f5061728',
      '394a5b6c7d8e9f0a',
      '1b2c3d4e5f607182',
      '9a0b1c2d3e4f5061',
      '728394a5b6c7d8e9',
      'f0a1b2c3d4e5f607',
      '18294a5b6c7d8e9f',
    )}`,
  ),
  blocks(
    'gcp service account private_key_id',
    'secret-adjacent-hex',
    `the service account json has "private_key_id": "${mk('9f2c1a7d3b5e8046a1c2', 'd3e4f5061728394a5b6c')}",`,
  ),
  blocks(
    'generic hex behind a secret-ish key name',
    'secret-adjacent-hex',
    `set API_SECRET=${mk('9f2c1a7d3b5e8046a1c2d3e4f5061728', '394a5b6c7d8e9f0a1b2c3d4e5f607182')} in the worker env`,
  ),
  // A benign qualifier next to `key` is a lookup key; next to `token`, `secret`,
  // `password` or `credential` it is still a credential. `the cache token` is
  // plausibly a Redis AUTH token — where the name is ambiguous the guard blocks,
  // because a false block costs one rewrite and a false pass costs a permanent
  // secret in git. These sit directly opposite the `cache key:` entries below.
  blocks(
    'a qualified API_KEY is still a key',
    'secret-adjacent-hex',
    `the cache API_KEY = ${mk('9f2c1a7d3b5e8046', 'a1c2d3e4f5061728')}`,
  ),
  blocks(
    'a qualified token is still a token',
    'secret-adjacent-hex',
    `the cache token = ${mk('394a5b6c7d8e9f0a', '1b2c3d4e5f607182')}`,
  ),
  blocks(
    'a benign qualifier does not excuse a trailing token',
    'secret-adjacent-hex',
    `sort key token: ${mk('1a2b3c4d5e6f7081', '9a0b1c2d3e4f5061')}`,
  ),
  // A structural modifier — `id`, `hash`, `digest`, `prefix` — never makes a name safe;
  // it only fails to make it dangerous. `cache_key_hash` is exempt because every other
  // word in it is accounted for, and `private_key_id` still blocks because `private` is
  // the unexplained word, not because of `id`. `token`, `secret`, `password` and
  // `credential` block regardless of what surrounds them.
  blocks(
    'a hash of a token is still a token',
    'secret-adjacent-hex',
    `token_hash = ${mk('5f607182394a5b6c', '7d8e9f0a1b2c3d4e')}`,
  ),
  blocks(
    'an id-suffixed secret is still a secret',
    'secret-adjacent-hex',
    `secret_id: ${mk('7d8e9f0a1b2c3d4e', '5f6071829a0b1c2d')}`,
  ),
  blocks(
    'a prefix of an api key is still key material',
    'secret-adjacent-hex',
    `api_key_prefix = ${mk('a1c2d3e4f5061728', '394a5b6c7d8e9f0a')}`,
  ),

  // ── layer 2: credentials embedded in a URI ─────────────────────────────────
  blocks('postgres creds', 'credentialed-uri', `DB at ${mk('postgres://admin:', 'hunter2swordfish', '@db.internal:5432/prod')}`),
  blocks('mongodb creds', 'credentialed-uri', mk('mongodb+srv://root:', 'S3cr3tP4ssw0rd', '@cluster0.mongodb.net')),
  blocks('https basic creds', 'credentialed-uri', `curl ${mk('https://svcuser:', 'tokenvalue123', '@api.internal/v1')}`),
  blocks(
    'redis dsn with an empty username',
    'credentialed-uri',
    `cache is ${mk('redis://:', 'hunter2swordfish', '@cache.internal:6379/0')}`,
  ),
  blocks(
    'password containing an @',
    'credentialed-uri',
    `amqp at ${mk('amqp://broker:', 'p@ssw0rd-with-at', '@rabbit.internal:5672/prod')}`,
  ),

  // ── layer 3: the project's own .env values, in the shapes .env files really take ──
  blocks(
    'env value declared with an inline comment',
    'env-value',
    'the partner integration authenticates with zulu-tango-9931-quebec',
    'ACME_PARTNER_TOKEN=zulu-tango-9931-quebec # rotate this every quarter\n',
  ),
  blocks(
    'env value in double quotes',
    'env-value',
    'session cookies are signed with whiskey-foxtrot-8817-lima',
    'SESSION_SECRET="whiskey-foxtrot-8817-lima"\n',
  ),
  blocks(
    'env value in single quotes',
    'env-value',
    'the webhook HMAC key is juliet-sierra-4402-oscar',
    "WEBHOOK_SIGNING_KEY='juliet-sierra-4402-oscar'\n",
  ),
  blocks(
    'env value behind an export prefix',
    'env-value',
    'CI exports bravo-november-5521-kilo before the deploy step',
    'export ACME_DEPLOY_TOKEN=bravo-november-5521-kilo\n',
  ),
  blocks(
    'env value whose URL PATH is the secret',
    'env-value',
    `alerts post to ${SLACK_WEBHOOK}`,
    `SLACK_WEBHOOK_URL=${SLACK_WEBHOOK}\n`,
  ),

  // ── layer 4: entropy, the last resort ──────────────────────────────────────
  blocks(
    'high-entropy base64 blob',
    'high-entropy',
    `the signing secret is ${mk('K7gNU3sdo+OL0wNhqoVWhr3g', '6s1xYv72ol/pe/Unols=')}`,
  ),
  blocks(
    'high-entropy url-safe base64 blob',
    'high-entropy',
    `the session key baked into the image is ${mk('Qk7Zm9xR-2pL4vN8', 'wT1yU6bA3cD5eF0gH', 'iJ7kM2nP9qS4tV6x')}`,
  ),
];

/**
 * MUST NOT BLOCK. Legitimate engineering notes that look secret-shaped.
 * A guard that fires on these is a guard developers will rip out — and every
 * tightening of layer 3 buys detection with over-fire risk, so this list grows
 * whenever that one does.
 */
const MUST_NOT_BLOCK = [
  // ── digests, identifiers and integrity hashes ──────────────────────────────
  allows('git commit sha', 'regression landed in c5ae9dd83eb1f2a4d5c6b7a8e9f0a1b2c3d4e5f6'),
  allows('sha256 hex digest', 'digest 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'),
  allows('docker image digest', 'pinned to sha256:2c3b1f0d8e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c'),
  allows('uuid', 'trace id 550e8400-e29b-41d4-a716-446655440000'),
  allows('ulid', 'the event id is 01HQ8Z9K3M4N5P6Q7R8S9T0V1W'),
  allows(
    'npm lockfile integrity',
    'resolved with integrity sha512-Wt9OTQCXnOsSp1cLdmUKrQ1gVAuLLNcJPnSjWCwtUnZOWMTKcNRDpqRmSb1Uk3UnAdaVWvKvNUXcCJHxOJbLQg==',
  ),
  allows(
    'sri hash in html',
    'script integrity="sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC"',
  ),
  allows('data uri image', 'icon is data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  allows('base64 test fixture', "the encoder test asserts encode('aaaaaaaaaaaaaaaaaaaaaaaaaaaaa') === 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE='"),

  // ── hex behind a key name that is not a credential ─────────────────────────
  // `secret-adjacent-hex` fires on a secret-ish word next to a long hex run. Plenty of
  // key names contain one of those words without being a secret, in both shapes: joined
  // (`cache_key`) and as a preceding word (`cache key:`). A cache key that is a sha256 is
  // exactly the kind of line a repo brain exists to record.
  allows('cache key as a separate word', 'cache key: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'),
  allows('cache key joined by an underscore', 'cache_key = 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'),
  allows('partition key', 'partition key: 2c3b1f0d8e7a6b5c4d3e2f1a0b9c8d7e'),
  allows('tokenizer, which merely contains "token"', 'tokenizer = 7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b'),
  allows('idempotency key', 'idempotency_key: 1a2b3c4d5e6f70819a0b1c2d3e4f5061'),
  allows('cache key with a structural modifier', 'cache_key_id = 2c3b1f0d8e7a6b5c4d3e2f1a0b9c8d7e'),
  allows('sort key hashed', 'sort_key_hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'),

  // ── code that happens to be dense ──────────────────────────────────────────
  allows('long kebab identifier', 'the feature flag is enable-new-checkout-flow-for-eu-customers-v2'),
  allows('file path', 'lives in node_modules/.pnpm/@babel+core@7.23.9/node_modules/@babel/core'),
  allows(
    'long relative import path',
    "it imports { createSelector } from '../../../../packages/state/src/selectors/dashboard/index.js'",
  ),
  allows(
    'minified js',
    '!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?t(exports):t(e.lib={})}(this,function(e){e.noop=function(){}});',
  ),
  allows(
    'css-in-js blob',
    'export const Card = styled.div`display:flex;align-items:center;padding:12px 16px;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,.08)`',
  ),
  allows(
    'tailwind class string',
    'className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium shadow-sm hover:bg-slate-50"',
  ),
  allows('semver list', 'bumped react 18.2.0, next 14.1.4, typescript 5.4.2'),
  allows('ipv6 address', 'the pod answers on 2001:0db8:85a3:0000:0000:8a2e:0370:7334 inside the mesh'),

  // ── prose about secrets, which is the whole point of a gotchas file ────────
  allows('env var name only', 'set STRIPE_SECRET_KEY in the deploy environment, never in code'),
  allows('prose about tokens', 'The auth token expires after 15 minutes; refresh it with the refresh token.'),
  allows('prose quoting an env var name', 'read DATABASE_URL from the environment; do not hardcode the connection string'),
  allows('prose naming a key format', 'production stripe keys start with sk_live_ and must never appear in a PR'),

  // ── placeholders and examples, which appear in every README ────────────────
  allows('placeholder github token', 'put GITHUB_TOKEN=<your-token-here> in .env.local'),
  allows('placeholder aws key', 'the example config shows AWS_ACCESS_KEY_ID=<your-key-id> and a matching secret'),
  allows('placeholder stripe test key', 'the seed script uses STRIPE_KEY=sk_test_replace_me_before_deploy'),
  allows('placeholder license key', 'enter the license as XXXX-XXXX-XXXX-XXXX in the settings pane'),

  // ── local DSNs: no credentials, and the host is the developer's own machine ──
  allows('local postgres dsn', 'the app talks to postgres://localhost:5432/appdb in dev'),
  allows('local redis dsn', 'the dev cache is redis://127.0.0.1:6379/0, flushed on every restart'),
  allows(
    'local dsn that is also an env value',
    'the app talks to postgres://localhost:5432/appdb in dev',
    'DATABASE_URL=postgres://localhost:5432/appdb\n',
  ),

  // ── public-prefixed env values are shipped to the browser by definition ────
  allows(
    'NEXT_PUBLIC_ env value',
    'docs live at https://example.com',
    'NEXT_PUBLIC_SITE=https://example.com\n',
  ),
  allows(
    'VITE_ env value',
    'the SPA calls https://api.staging.example.com from the browser',
    'VITE_API_URL=https://api.staging.example.com\n',
  ),
  allows(
    'public and private keys in the same .env',
    'the marketing site is https://example.com and the API is behind it',
    'NEXT_PUBLIC_SITE=https://example.com\nSESSION_SECRET=whiskey-foxtrot-8817-lima\n',
  ),
];

const envFor = (entry) => (entry.env ? collectEnvValuesFrom({ '.env': entry.env }) : []);

test('blocks every entry in the must-block corpus', () => {
  for (const entry of MUST_BLOCK) {
    const res = scan(entry.content, { envValues: envFor(entry) });
    assert.equal(res.ok, false, `expected BLOCK for "${entry.label}": ${entry.content.slice(0, 60)}`);
    const rules = res.findings.map((f) => f.rule);
    assert.ok(
      rules.includes(entry.rule),
      `"${entry.label}" must trigger ${entry.rule}, got [${rules.join(', ') || 'nothing'}]`,
    );
  }
});

test('allows every entry in the must-not-block corpus', () => {
  for (const entry of MUST_NOT_BLOCK) {
    const res = scan(entry.content, { envValues: envFor(entry) });
    assert.equal(
      res.ok,
      true,
      `expected ALLOW for "${entry.label}" but got: ${JSON.stringify(res.findings)}`,
    );
  }
});

/**
 * The meta-test. "Exhaustive" is a claim the corpora have to earn, so every rule the guard
 * can emit must be provably reachable from an entry above — a detection rule added later
 * with no corpus coverage fails CI instead of shipping untested.
 */
test('every rule name the guard can emit is covered by the must-block corpus', () => {
  const names = guard.RULE_NAMES;
  assert.ok(
    Array.isArray(names) && names.length > 0,
    'src/guard.mjs must export RULE_NAMES: a flat array of every rule name scan() can emit',
  );

  const observed = new Set();
  for (const entry of MUST_BLOCK) {
    for (const finding of scan(entry.content, { envValues: envFor(entry) }).findings) {
      observed.add(finding.rule);
    }
  }

  const uncovered = names.filter((name) => !observed.has(name));
  assert.deepEqual(
    uncovered,
    [],
    `these detection rules have no MUST_BLOCK entry that triggers them: ${uncovered.join(', ')}. ` +
      'Add a fixture that fires each one — an untested rule is an unverified claim.',
  );

  const undeclared = [...observed].filter((rule) => !names.includes(rule));
  assert.deepEqual(
    undeclared,
    [],
    `scan() emitted rules that RULE_NAMES does not list: ${undeclared.join(', ')}`,
  );
});

test('every must-block entry names a rule the guard declares', () => {
  const names = guard.RULE_NAMES ?? [];
  for (const entry of MUST_BLOCK) {
    assert.ok(names.includes(entry.rule), `"${entry.label}" expects rule ${entry.rule}, which RULE_NAMES does not list`);
  }
});

/**
 * `secret-adjacent-hex` carries the whole hex class on its own — layer 4's threshold sits
 * above log2(16) by design (SPEC D7), so nothing else can reach a hex-encoded secret. Every
 * narrowing that buys back a benign `cache key: <sha256>` risks paying for it here, so the
 * count is asserted too: dropping a fixture is not a way to make a narrowing go green.
 */
test('narrowing secret-adjacent-hex does not cost the hex class', () => {
  const hex = MUST_BLOCK.filter((e) => e.rule === 'secret-adjacent-hex');
  assert.deepEqual(
    hex.map((e) => e.label),
    [
      'rails secret_key_base',
      'gcp service account private_key_id',
      'generic hex behind a secret-ish key name',
      'a qualified API_KEY is still a key',
      'a qualified token is still a token',
      'a benign qualifier does not excuse a trailing token',
      'a hash of a token is still a token',
      'an id-suffixed secret is still a secret',
      'a prefix of an api key is still key material',
    ],
    'a fixture was removed from the hex class — narrowing the rule is the fix, deleting its coverage is not',
  );
  for (const entry of hex) {
    const rules = scan(entry.content, { envValues: envFor(entry) }).findings.map((f) => f.rule);
    assert.ok(rules.includes('secret-adjacent-hex'), `"${entry.label}" no longer trips the hex rule`);
  }
});

// ── the choke point ──────────────────────────────────────────────────────────
// The corpus proves scan() classifies correctly. It does not prove scan() is called on the
// path that writes memory — and it was possible to delete the scan() call in src/memory.mjs
// with the whole suite still green. These two go through appendGotchas, so they fail if the
// guard is ever unhooked from the write path.

test('a pattern-matched secret cannot reach gotchas.md through appendGotchas', () => {
  const root = tmpRepo();
  const secret = mk('AKIA', 'IOSFODNN7EXAMPLE');
  const res = appendGotchas(root, [`the nightly sync authenticates with ${secret}`]);

  assert.deepEqual(res.written, [], 'a secret-bearing gotcha must never be written');
  assert.equal(
    res.blocked.length,
    1,
    'appendGotchas must report the entry as blocked — an empty blocked list means the guard is no longer called from the memory write path',
  );
  assert.equal(res.blocked[0].findings[0].rule, 'aws-access-key-id');
  assert.ok(!gotchasText(root).includes(secret), 'the secret reached disk');
});

test('appendGotchas harvests the target repo .env, so a project secret is blocked too', () => {
  const root = tmpRepo();
  writeFileSync(join(root, '.env'), 'ACME_PARTNER_TOKEN=zulu-tango-9931-quebec\n');
  const res = appendGotchas(root, [
    'the retry backoff is 3 attempts with jitter',
    'the partner integration authenticates with zulu-tango-9931-quebec',
  ]);

  assert.deepEqual(res.written, ['the retry backoff is 3 attempts with jitter']);
  assert.equal(res.blocked.length, 1, 'the .env-derived secret must be blocked on the real append path');
  assert.equal(res.blocked[0].findings[0].rule, 'env-value');
  assert.ok(!gotchasText(root).includes('zulu-tango-9931-quebec'), 'the secret reached disk');
});

// ── layer 3 detail ───────────────────────────────────────────────────────────

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

test('strips an inline comment from an env value instead of treating it as part of the secret', () => {
  const envValues = collectEnvValuesFrom({
    '.env': 'ACME_PARTNER_TOKEN=zulu-tango-9931-quebec # rotate this every quarter\n',
  });
  const values = envValues.filter((v) => v.key === 'ACME_PARTNER_TOKEN');
  assert.equal(values.length, 1);
  assert.equal(values[0].value, 'zulu-tango-9931-quebec');
});

test('names the variable without its export prefix, so the report points at a real env var', () => {
  const envValues = collectEnvValuesFrom({
    '.env': 'export ACME_DEPLOY_TOKEN=bravo-november-5521-kilo\n',
  });
  const res = scan('CI exports bravo-november-5521-kilo before the deploy step', { envValues });
  assert.equal(res.ok, false);
  assert.equal(res.findings[0].detail.includes('ACME_DEPLOY_TOKEN'), true);
  assert.equal(
    res.findings[0].detail.includes('export'),
    false,
    'the reported key must be ACME_DEPLOY_TOKEN, not "export ACME_DEPLOY_TOKEN"',
  );
});

test('ignores short and non-secret env values so PORT=3000 is not a tripwire', () => {
  const envValues = collectEnvValuesFrom({
    '.env': 'PORT=3000\nNODE_ENV=development\nDEBUG=true\n',
  });
  assert.equal(envValues.length, 0);
  const res = scan('we run on port 3000 in development with debug true', { envValues });
  assert.equal(res.ok, true);
});

// ── layer 3 over-fire, measured ──────────────────────────────────────────────
// A public site URL and a localhost DSN are env values by the letter of layer 3 and
// public knowledge by any other reading. Blocking a note that mentions either makes the
// guard the thing standing between a developer and writing down how their app works.

test('a NEXT_PUBLIC_ value in a note is not a secret', () => {
  const envValues = collectEnvValuesFrom({
    '.env': 'NEXT_PUBLIC_SITE=https://example.com\nDATABASE_URL=postgres://localhost:5432/appdb\n',
  });
  const res = scan('docs live at https://example.com', { envValues });
  assert.equal(res.ok, true, `expected ALLOW, got: ${JSON.stringify(res.findings)}`);
});

test('a localhost DSN in a note is not a secret', () => {
  const envValues = collectEnvValuesFrom({
    '.env': 'NEXT_PUBLIC_SITE=https://example.com\nDATABASE_URL=postgres://localhost:5432/appdb\n',
  });
  const res = scan('the app talks to postgres://localhost:5432/appdb in dev', { envValues });
  assert.equal(res.ok, true, `expected ALLOW, got: ${JSON.stringify(res.findings)}`);
});

/**
 * The limit of that exemption, pinned so nobody widens it into a hole. A Slack webhook
 * carries no credentials and no local host — the secret IS the path. It is exempt from
 * nothing.
 */
test('a credential-free URL whose path is the secret is still blocked as an env value', () => {
  const webhook = SLACK_WEBHOOK;
  const envValues = collectEnvValuesFrom({ '.env': `SLACK_WEBHOOK_URL=${webhook}\n` });
  const res = scan(`alerts post to ${webhook}`, { envValues });
  assert.equal(res.ok, false, 'a webhook URL from .env must still be blocked');
  assert.equal(res.findings[0].rule, 'env-value');
});

test('reports the offending line number so a human can find it', () => {
  const token = mk('ghp', '_', '016C7e5c9AbCdEfGhIjKlMnOpQrStUvWxYz12');
  const res = scan(`line one is fine\nline two is fine\ntoken ${token}`);
  assert.equal(res.ok, false);
  assert.equal(res.findings[0].lineNo, 3);
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** Every temp dir this file creates, removed on exit — the suite used to leave them behind. */
const TEMP_DIRS = [];

function tmpRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-guard-'));
  TEMP_DIRS.push(dir);
  return dir;
}

process.on('exit', () => {
  for (const dir of TEMP_DIRS) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // a leftover temp dir is not worth failing a run over
    }
  }
});

/** Write a throwaway repo with the given files, collect its env values. */
function collectEnvValuesFrom(files) {
  const dir = tmpRepo();
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return collectEnvValues(dir);
}

/** Whatever landed in the repo's gotchas file, or '' if the guard stopped it being created. */
function gotchasText(root) {
  const abs = join(root, GOTCHAS);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : '';
}
