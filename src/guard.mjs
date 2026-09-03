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
  ['stripe-webhook-secret', /\bwhsec_[A-Za-z0-9]{16,}\b/],
  ['gitlab-token', /\bglpat-[A-Za-z0-9_-]{20,}/],
  ['slack-app-token', /\bxapp-[A-Za-z0-9-]{10,}\b/],
  ['digitalocean-token', /\bdop_v1_[A-Za-z0-9]{32,}\b/],
  ['sendgrid-key', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/],
  ['figma-token', /\bfigd_[A-Za-z0-9_-]{20,}/],
  ['huggingface-token', /\bhf_[A-Za-z0-9]{20,}\b/],
  ['atlassian-token', /\bATATT[A-Za-z0-9_=.-]{20,}/],
  ['twilio-account-sid', /\bAC[0-9a-fA-F]{32}\b/],
];

// ── Layer 1b: hex secrets, which only a key name can identify ────────────────
//
// Layer 4 can never reach these — its threshold sits above log2(16), by design
// (SPEC D7) — so a long hex run is a secret only when a secret-ish name introduces
// it. Two conditions, which is why this cannot live in PATTERNS.
//
// The `:`/`=` separator is load-bearing: without it this fires on every commit SHA
// and digest in prose.
const HEX_ASSIGNMENT = /(?:([\w.-]{1,40})\s+)?([\w.-]{0,40})["']?\s*[:=]\s*["']?[0-9a-fA-F]{32,}\b/g;
const SECRET_WORD = /secret|token|key|password|passwd|pwd|credential/i;

/**
 * Words that make a name public rather than secret. `cache key: <sha256>` is an ordinary
 * engineering note — precisely what a repo brain exists to record — and a guard that blocks
 * real notes is a guard the team removes. Matched per word, never as a substring, so that
 * `browser_token` stays blocked even though `browser` contains `row`.
 */
const BENIGN_QUALIFIERS = new Set([
  'cache', 'partition', 'sort', 'primary', 'foreign', 'shard', 'object', 'idempotency',
  'row', 'index', 'map', 'tokenizer', 'keyboard', 'hockey', 'monkey', 'donkey', 'turkey',
  // Structural modifiers. `cache_key_hash` is the same ordinary note as `cache key`, and
  // without these a third word would defeat the exemption. They cannot rescue a real
  // secret: what blocks `private_key_id` is `private`, which is not here.
  'id', 'ids', 'hash', 'digest', 'checksum', 'prefix', 'suffix', 'name',
]);

/**
 * The only genuinely ambiguous word. A cache *key* is a lookup key; a cache *token* is auth,
 * so `token`, `secret`, `password` and `credential` are never generic and no qualifier can
 * excuse them. When the name is ambiguous the guard blocks: a false block costs a developer
 * one rewrite, a false pass costs a permanent secret in git history.
 */
const GENERIC_WORDS = new Set(['key', 'keys']);

/** Split an identifier into words on separators and camelCase humps. */
function nameWords(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function hasSecretAdjacentHex(line) {
  for (const [, qualifier, name] of line.matchAll(HEX_ASSIGNMENT)) {
    const words = nameWords([qualifier, name].filter(Boolean).join(' '));
    if (!SECRET_WORD.test(words.join(' '))) continue;
    // Exempt only when EVERY word is benign or generic — one unexplained word is enough
    // to make the hex a secret again.
    if (words.every((w) => BENIGN_QUALIFIERS.has(w) || GENERIC_WORDS.has(w))) continue;
    return true;
  }
  return false;
}

// ── Layer 2: credentials embedded in a URI ───────────────────────────────────
// The username may be empty (`redis://:password@host` is the standard Redis DSN) and
// the password may be empty (`https://token:@host` is the token-as-basic-user idiom).
// Both empty is not a credential, so at least one side must carry a value.
const CREDENTIALED_URI = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s:@/]+:[^\s@/]*|:[^\s@/]+)@/i;

// ── Layer 4 support: shapes that are high-entropy but demonstrably not secrets ──
const PURE_HEX = /^[0-9a-fA-F]+$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SRI_PREFIX = /^sha(?:1|256|384|512)-/;
const DATA_URI = /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;
const TOKEN = /[A-Za-z0-9+/=_-]+/g;

const ENTROPY_MIN_LENGTH = 32;
const ENTROPY_THRESHOLD = 4.5;

/**
 * Every rule name this module can emit. A rule that is not in this list — or a name here
 * with no corpus entry behind it — is a detection nobody has proved works (SPEC D8).
 */
export const RULE_NAMES = [
  ...PATTERNS.map(([rule]) => rule),
  'secret-adjacent-hex',
  'credentialed-uri',
  'env-value',
  'high-entropy',
];

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

// ── Layer 3 support: `.env` entries that are public by definition ────────────

/** Prefixes whose whole purpose is that the value is shipped to a browser. */
const PUBLIC_ENV_KEY = /^(?:NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|EXPO_PUBLIC_|NUXT_PUBLIC_|GATSBY_)/;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
const URI_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\/([^\s/?#]*)/i;

/**
 * A URL whose host is this machine. It cannot be a credential *if* it carries no
 * userinfo — `postgres://user:pw@localhost/db` still leaks a password.
 *
 * Deliberately not extended to credential-free URLs in general: a Slack webhook is a
 * credential-free URL whose path is the secret.
 */
function isLocalUrl(value) {
  const m = URI_AUTHORITY.exec(value);
  if (!m) return false;
  const authority = m[1];
  if (authority.includes('@')) return false;
  const host = authority.replace(/:\d+$/, '').toLowerCase();
  return LOCAL_HOSTS.has(host) || /^[a-z0-9-]+\.local$/.test(host);
}

/** True when matching this `.env` entry would be an over-block, not a catch. */
function isPublicEnvValue(key, value) {
  return PUBLIC_ENV_KEY.test(key) || isLocalUrl(value);
}

function scanLine(line, lineNo, envValues, findings) {
  for (const [rule, re] of PATTERNS) {
    if (re.test(line)) findings.push({ rule, lineNo, detail: `matched ${rule}` });
  }

  if (hasSecretAdjacentHex(line)) {
    findings.push({ rule: 'secret-adjacent-hex', lineNo, detail: 'hex run introduced by a secret-ish key name' });
  }

  if (CREDENTIALED_URI.test(line)) {
    findings.push({ rule: 'credentialed-uri', lineNo, detail: 'URI contains inline credentials' });
  }

  // Layer 3 — the project's own secrets, which no pattern could know about.
  // Report the variable name only; the value must never leave this function.
  for (const { key, value } of envValues) {
    if (line.includes(value) && !isPublicEnvValue(key, value)) {
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
// A monorepo keeps its secrets in `apps/web/.env.local`, not at the root — but this runs
// on every memory append, so the walk is bounded on all three axes: depth, directory, count.
const ENV_MAX_DEPTH = 3;
const ENV_MAX_FILES = 50;
const ENV_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

/** Breadth-first walk for `.env*` files. An unreadable directory is skipped, never thrown. */
function findEnvFiles(repoRoot) {
  const found = [];
  const queue = [[repoRoot, 0]];
  while (queue.length > 0 && found.length < ENV_MAX_FILES) {
    const [dir, depth] = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      // Symlinked directories report false here, which keeps the walk inside the repo.
      if (entry.isDirectory()) {
        if (depth < ENV_MAX_DEPTH && !ENV_SKIP_DIRS.has(entry.name)) {
          queue.push([join(dir, entry.name), depth + 1]);
        }
      } else if (ENV_FILE.test(entry.name)) {
        found.push(join(dir, entry.name));
        if (found.length >= ENV_MAX_FILES) break;
      }
    }
  }
  return found;
}

const ENV_ASSIGNMENT = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/;

/**
 * The value the application would actually load. dotenv treats an unquoted `#` as the
 * start of a comment, so `KEY=abc # prod` is the value `abc` — harvesting the comment
 * along with it stores a string that can never match, which silently disarms layer 3.
 *
 * Known limitation, accepted: a backslash-escaped quote inside a quoted value
 * (`PASS="a\"b"`) is harvested truncated, so that value is a miss.
 */
function parseEnvValue(rest) {
  const quote = rest[0];
  if (quote === '"' || quote === "'" || quote === '`') {
    const close = rest.indexOf(quote, 1);
    if (close > 0) return rest.slice(1, close);
  }
  const hash = rest.indexOf('#');
  return (hash === -1 ? rest : rest.slice(0, hash)).trim();
}

export function collectEnvValues(repoRoot) {
  const out = [];
  for (const file of findEnvFiles(repoRoot)) {
    let body;
    try {
      body = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = ENV_ASSIGNMENT.exec(line);
      if (!m) continue;
      const key = m[1];
      const value = parseEnvValue(m[2].trim());
      if (value.length < MIN_ENV_VALUE_LENGTH) continue;
      if (NON_SECRET_VALUES.has(value.toLowerCase())) continue;
      out.push({ key, value });
    }
  }
  return out;
}
