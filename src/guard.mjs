import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The secret guard.
 *
 * Memory in a Cortex repo brain is committed and ungated — a session's learnings
 * append straight to `.cortex/memory/` and land in company git history. There is no
 * human promotion step, so this module is the only thing standing between an agent's
 * observation and a permanent record in someone's repository. It blocks; it never
 * redacts and never warns-and-continues.
 */

// ── Layer 1: known key shapes ────────────────────────────────────────────────
const PATTERNS = [
  ['aws-access-key-id', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['stripe-key', /\b[sr]k_live_[A-Za-z0-9]{16,}\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['openai-key', /\bsk-proj-[A-Za-z0-9_-]{20,}\b/],
  ['private-key-block', /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];

// ── Layer 2: credentials embedded in a URI ───────────────────────────────────
const CREDENTIALED_URI = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i;

// ── Layer 4 support: shapes that are high-entropy but demonstrably not secrets ──
const PURE_HEX = /^[0-9a-fA-F]+$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SRI_PREFIX = /^sha(?:1|256|384|512)-/;
const DATA_URI = /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;
const TOKEN = /[A-Za-z0-9+/=_-]+/g;

const ENTROPY_MIN_LENGTH = 32;
const ENTROPY_THRESHOLD = 4.5;

/** Shannon entropy in bits per character. */
export function entropy(str) {
  const freq = new Map();
  for (const ch of str) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * A token is exempt from the entropy check when its shape proves it is a digest,
 * an identifier, or an integrity hash. Entropy alone cannot tell a random 32-byte
 * secret from an npm lockfile `sha512-` integrity value — both sit near 5.9 bits
 * per character. Only the shape separates them.
 */
function isBenignShape(token) {
  return PURE_HEX.test(token) || UUID.test(token) || SRI_PREFIX.test(token);
}

function scanLine(line, lineNo, envValues, findings) {
  for (const [rule, re] of PATTERNS) {
    if (re.test(line)) findings.push({ rule, lineNo, detail: `matched ${rule}` });
  }

  if (CREDENTIALED_URI.test(line)) {
    findings.push({ rule: 'credentialed-uri', lineNo, detail: 'URI contains inline credentials' });
  }

  // Layer 3 — the project's own secrets, which no pattern could know about.
  // Report the variable name only; the value must never leave this function.
  for (const { key, value } of envValues) {
    if (line.includes(value)) {
      findings.push({ rule: 'env-value', lineNo, detail: `matches the value of ${key}` });
    }
  }

  // Layer 4 — last resort. Layers 1-3 do the real work.
  const stripped = line.replace(DATA_URI, ' ');
  for (const token of stripped.match(TOKEN) ?? []) {
    if (token.length < ENTROPY_MIN_LENGTH || isBenignShape(token)) continue;
    if (entropy(token) > ENTROPY_THRESHOLD) {
      findings.push({ rule: 'high-entropy', lineNo, detail: `${token.length}-char high-entropy string` });
    }
  }
}

/**
 * Scan content bound for `.cortex/memory/`.
 * @returns {{ok: boolean, findings: Array<{rule: string, lineNo: number, detail: string}>}}
 */
export function scan(content, { envValues = [] } = {}) {
  const findings = [];
  const lines = String(content).split('\n');
  for (let i = 0; i < lines.length; i++) {
    scanLine(lines[i], i + 1, envValues, findings);
  }
  return { ok: findings.length === 0, findings };
}

// ── .env harvesting (comparison material only) ───────────────────────────────

const ENV_FILE = /^\.env($|\.)/;
const MIN_ENV_VALUE_LENGTH = 8;

/** Values that are long enough to look secret but never are. */
const NON_SECRET_VALUES = new Set([
  'development', 'production', 'staging', 'localhost', 'undefined',
  'postgres', 'postgresql', 'sqlite', 'mysql', 'mongodb', 'redis',
  'verbose', 'warning', 'disabled', 'enabled', 'default',
]);

/**
 * Read the repo's `.env*` files and return the values worth comparing against.
 * These are used for `String.includes` comparison only — they are never written,
 * logged, or surfaced in an error message.
 */
export function collectEnvValues(repoRoot) {
  let names;
  try {
    names = readdirSync(repoRoot).filter((n) => ENV_FILE.test(n));
  } catch {
    return [];
  }

  const out = [];
  for (const name of names) {
    let body;
    try {
      body = readFileSync(join(repoRoot, name), 'utf8');
    } catch {
      continue;
    }
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (value.length < MIN_ENV_VALUE_LENGTH) continue;
      if (NON_SECRET_VALUES.has(value.toLowerCase())) continue;
      out.push({ key, value });
    }
  }
  return out;
}
