// The single gate on everything written into .cortex/memory/.
//
// Cortex's memory is COMMITTED so that several developers and their agents share one context.
// That inverts the old vault rule: instead of "personal content stays gitignored", the rule here
// is "nothing personal or secret may enter memory at all", because memory ships with the code.
// One write path, one gate — the same shape as the traversal guard in paths.js.

export class RefusedWriteError extends Error {
  constructor(findings) {
    const kinds = [...new Set(findings.map((f) => f.kind))].join(", ");
    super(`refusing to write memory: contains ${kinds}`);
    this.name = "RefusedWriteError";
    this.code = "refused_write";
    this.findings = findings;
  }
}

// Ordered most-specific first so a match reports the useful name rather than a generic one.
const RULES = [
  { kind: "private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g },
  { kind: "AWS access key id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { kind: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "Stripe key", re: /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}\b/g },
  { kind: "OpenAI key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: "Anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: "connection string with password", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s:/@]+@[^\s/]+/gi },
  // The key word may be embedded in a longer identifier (AUTH_TOKEN, dbPassword), so the
  // boundary is the assignment rather than a word break — `\btoken` never matches AUTH_TOKEN.
  { kind: "assigned secret", re: /[A-Za-z0-9_]*(?:api[_-]?key|secret|password|passwd|token|credential)[A-Za-z0-9_]*\s*[:=]\s*['"][^'"\n]{8,}['"]/gi },
  { kind: "private SSH key path", re: /\b~?\/?[\w./-]*\/\.ssh\/id_(?:rsa|ed25519|ecdsa)\b/g },
  { kind: "bearer token", re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g },
];

/**
 * A matched value that is a PLACEHOLDER or a REFERENCE is not a credential — it is a name standing
 * in for one. Skipping these is not a loosening of the gate: there is no secret in `${DB_PASSWORD}`
 * to protect.
 *
 * Every example below came from a real, well-maintained repository, and each one was reported as a
 * CRITICAL finding. Because severity is control flow (ADR 0006), that made a false alarm the first
 * question Cortex asked a new user:
 *
 *   a Maven antrun attribute whose value is a $version$ placeholder
 *   a commented-out Rack example whose value is the word CHANGEME padded to length
 *   a constant whose NAME ends in _TOKEN_IDENTIFIER, holding the name of a token rather than one
 *   a Python format template of the shape scheme://{}:{}@{}
 *
 * Written as prose rather than as literal examples on purpose: the literals set this scanner off
 * against its own source file, which is how the exemption marker gets reached for by reflex. A file
 * that must not hold credentials should not need an exemption to describe them.
 *
 * A tool that cries wolf on four of six respected repositories teaches people to skip the section,
 * and then it fails on the one that matters.
 */
const PLACEHOLDER = [
  /\$\{[^}]*\}/,           // ${VAR} — shell, Maven, JS template
  /\{\{[^}]*\}\}/,         // {{var}} — Handlebars, Jinja
  /\{\}/,                  // {} — Python str.format, Rust format!
  /^\$[\w.-]+\$/,          // $next-version$ — Maven antrun, IDE templates
  /^<[^>]*>$/,             // <your-key-here>
  /^%[sdv]$/,              // printf
  /process\.env\b|os\.environ|System\.getenv|ENV\[/,  // a read of the real value, not the value
  /^(?:changeme|change[-_]?me|xxx+|y{3,}|placeholder|example|dummy|redacted|todo|none|null|undefined|test|fake|sample|your[-_].*|my[-_]secret|\*+|\.{3,})/i,
];

/** Does this match consist only of a placeholder standing in for a credential? */
function isPlaceholder(match) {
  // The value is what sits inside the quotes; for a connection string it is the whole match.
  const quoted = match.match(/['"]([^'"\n]*)['"]/);
  const value = quoted ? quoted[1] : match;
  return PLACEHOLDER.some((re) => re.test(value));
}

/**
 * Scan text for material that must never reach committed memory.
 * Returns [] when clean. Never throws — callers decide what to do with the findings.
 */
export function scan(text) {
  const src = String(text ?? "");
  const findings = [];
  for (const { kind, re } of RULES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const line = src.slice(0, m.index).split("\n").length;
      if (isPlaceholder(m[0])) {
        if (m[0].length === 0) re.lastIndex++;
        continue;
      }
      findings.push({ kind, line, match: redact(m[0]) });
      if (m[0].length === 0) re.lastIndex++; // guard against a zero-width match looping
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

/** Never echo a secret back in full, not even in an error message. */
export function redact(s) {
  const str = String(s);
  if (str.length <= 12) return "*".repeat(str.length);
  return `${str.slice(0, 4)}${"*".repeat(8)}${str.slice(-4)}`;
}

/** True when the text is safe to commit. */
export function isClean(text) {
  return scan(text).length === 0;
}

/**
 * Gate a memory write. Throws RefusedWriteError when the content carries a secret — the write is
 * refused outright rather than sanitised, because silently rewriting a developer's note is a worse
 * failure than declining it and saying why.
 */
export function assertWritable(text) {
  const findings = scan(text);
  if (findings.length) throw new RefusedWriteError(findings);
  return true;
}

// --- personal data -------------------------------------------------------------------------------
//
// A credential is never right in committed memory. Personal data — somebody's email address, phone
// number, bank account — usually is not either, and committed memory makes it expensive: it is in
// every clone, and erasing it means rewriting history (docs/erasure.md). But a note saying "ask
// ops@ about the cut-over" or naming the team's shared inbox is legitimate, so the default is to
// WARN, not refuse: the write goes through and the result says what kind of personal data it held
// and on which line. `CORTEX_PII=refuse` makes it a refusal; `off` stops the scan.
// docs/adr/0027 argues the default.
//
// With `CORTEX_PII` unset, the mode is the profile's (`policy.pii`, core/profile.js): `warn` on home
// and lab, `refuse` on work, where a colleague's or a customer's details pushed to a company remote
// are the employer's liability too. `CORTEX_PII` still overrides it, either way. The amendment to
// docs/adr/0027 records this.
//
// Every detector is conservative on purpose. A gate that flags version numbers and dates as phone
// numbers is a gate people learn to ignore. The two with a checksum — IBAN (mod 97) and card numbers
// (Luhn) — are checked, so a random number of the right shape almost never passes.

export const PII_MODES = Object.freeze(["warn", "refuse", "off"]);
export const PII_DEFAULT = "warn";

// Addresses that name nobody: RFC 2606 / 6761 reserved names, mDNS `.local` (RFC 6762), GitHub's noreply domain, and a git
// SSH remote (`git@host:owner/repo`), which is a protocol user rather than a person.
const RESERVED_EMAIL_DOMAIN = /(?:^|\.)(?:example\.(?:com|net|org)|example|test|invalid|localhost|local|users\.noreply\.github\.com)$/i;
// `icon@2x.png` is a file name, not an address.
const FILE_TLD = /\.(?:png|jpe?g|gif|svg|webp|ico|js|mjs|cjs|ts|tsx|jsx|css|scss|json|ya?ml|md|txt|html?|lock|map)$/i;

function emailNamesSomeone(match) {
  const [local, domain] = match.split("@");
  if (RESERVED_EMAIL_DOMAIN.test(domain) || FILE_TLD.test(domain)) return false;
  if (/^(?:git|no-?reply)$/i.test(local)) return false;
  return true;
}

const digitsOf = (s) => s.replace(/\D/g, "");

function phoneLength(match) {
  const n = digitsOf(match).length;
  return n >= 8 && n <= 15;
}

/** ISO 13616: move the first four characters to the end, letters to numbers, the result mod 97 is 1. */
export function ibanValid(match) {
  const s = match.replace(/\s+/g, "").toUpperCase();
  if (s.length < 15 || s.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** Luhn, over the digits only. */
export function luhnValid(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function cardNumber(match) {
  const seps = new Set(match.replace(/\d/g, ""));
  if (seps.size > 1) return false; // mixed separators: a list of numbers, not one card
  const d = digitsOf(match);
  if (d.length < 13 || d.length > 19) return false;
  if (!/^[3-6]/.test(d)) return false; // the card networks' leading digits; an epoch in ms starts with 1
  if (/^(\d)\1+$/.test(d)) return false;
  return luhnValid(d);
}

const PII_RULES = [
  {
    kind: "email address",
    re: /(?<![\w.%+-])[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}(?![\w-])/g,
    keep: emailNamesSomeone,
  },
  // International: a `+` and a country code, after a space or punctuation and never at the start of
  // a line — a diff's added line starts with `+`, and so does a list of version bumps.
  {
    kind: "phone number",
    re: /(?<=[ \t(:;,])\+[1-9]\d{0,2}(?:[ .-]?\(?\d{1,4}\)?){2,5}(?![\d-])/g,
    keep: phoneLength,
  },
  // National with an area code in brackets: (020) 7946 0958, (555) 123-4567.
  { kind: "phone number", re: /(?<![\w)])\(\d{2,5}\)[ .-]?\d{3,4}[ .-]?\d{3,4}(?![\w-])/g, keep: phoneLength },
  // North American with one separator used twice: 555-123-4567, 555.123.4567. Never spaces — a
  // table of numbers has those — and a date is 4-2-2, an IP's last group is three digits at most.
  { kind: "phone number", re: /(?<![\w.-])\d{3}([-.])\d{3}\1\d{4}(?![\w.-])/g, keep: () => true },
  { kind: "IBAN", re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g, keep: ibanValid },
  { kind: "payment card number", re: /(?<![\w.-])\d(?:[ -]?\d){12,18}(?![\w.-])/g, keep: cardNumber },
];

/**
 * Scan text for personal data. `[{ kind, line }]`, sorted by line — never the match itself, not
 * even redacted: an email address with its middle starred is still most of an email address.
 * Never throws.
 */
export function scanPersonal(text) {
  const src = String(text ?? "");
  const out = [];
  const seen = new Set();
  for (const { kind, re, keep } of PII_RULES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (!keep(m[0])) continue;
      const line = src.slice(0, m.index).split("\n").length;
      const key = `${line}\0${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, line });
    }
  }
  return out.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

export class UnknownPiiModeError extends Error {
  constructor(value) {
    super(`unknown CORTEX_PII: ${JSON.stringify(value)}. Expected one of: ${PII_MODES.join(", ")}`);
    this.name = "UnknownPiiModeError";
    this.code = "unknown_pii_mode";
  }
}

/**
 * The mode and what set it: `{ mode, from }`, `from` being `CORTEX_PII`, `profile` or `default`.
 * `CORTEX_PII` wins; unset or empty, the profile's `policy.pii` applies; with no policy, `warn`. An
 * unknown value throws rather than falling back, for the reason ADR 0015 gives about a profile:
 * `CORTEX_PII=refuse` misspelt must not quietly mean `warn` while the person believes it refuses.
 */
export function piiSetting({ env = {}, policy } = {}) {
  const raw = String(env.CORTEX_PII ?? "").trim().toLowerCase();
  if (raw) {
    if (!PII_MODES.includes(raw)) throw new UnknownPiiModeError(env.CORTEX_PII);
    return { mode: raw, from: "CORTEX_PII" };
  }
  if (policy && policy.pii !== undefined) {
    if (!PII_MODES.includes(policy.pii)) throw new UnknownPiiModeError(policy.pii);
    return { mode: policy.pii, from: "profile" };
  }
  return { mode: PII_DEFAULT, from: "default" };
}

/** The mode alone. See `piiSetting`. */
export function piiMode({ env = {}, policy } = {}) {
  return piiSetting({ env, policy }).mode;
}

/** How a message names what set the mode. */
const setBy = (from, mode, policy) =>
  from === "profile" ? `the ${policy?.label ?? "current"} profile's mode is ${mode}` : `CORTEX_PII is ${mode}`;

/** A published write refused because it holds personal data and `CORTEX_PII=refuse`. */
export class PersonalDataError extends RefusedWriteError {
  constructor(findings, { why = "CORTEX_PII is refuse" } = {}) {
    super(findings);
    this.name = "PersonalDataError";
    this.code = "personal_data";
    const kinds = [...new Set(findings.map((f) => f.kind))].join(", ");
    const lines = [...new Set(findings.map((f) => f.line))].join(", ");
    this.message =
      `refusing to publish: contains personal data (${kinds}, line ${lines}). ${why[0].toUpperCase()}${why.slice(1)}. ` +
      "Nothing was written. Name the role or the team instead of the person.";
  }
}

/**
 * The personal-data gate. `{ mode, findings, warning }`: `warning` is one sentence for the caller to
 * pass on when the mode is `warn` and something was found, otherwise null. Throws
 * `PersonalDataError` when the mode is `refuse` and something was found, and `UnknownPiiModeError`
 * for a bad `CORTEX_PII`. `policy` is the profile's, and sets the mode when `CORTEX_PII` is unset;
 * core/gate.js always passes it.
 */
export function gatePersonal(text, { env = process.env, policy } = {}) {
  const { mode, from } = piiSetting({ env, policy });
  const why = setBy(from, mode, policy);
  if (mode === "off") return { mode, findings: [], warning: null };
  const findings = scanPersonal(text);
  if (!findings.length) return { mode, findings, warning: null };
  if (mode === "refuse") throw new PersonalDataError(findings, { why });
  const kinds = [...new Set(findings.map((f) => f.kind))].join(", ");
  const lines = [...new Set(findings.map((f) => f.line))].join(", ");
  return {
    mode,
    findings,
    warning:
      `personal data: this text holds ${kinds} (line ${lines}), and it was written anyway because ` +
      `${why}. Once committed or pushed it is in every clone, and removing it means ` +
      "rewriting history (Cortex's docs/erasure.md). Tell the user; CORTEX_PII=refuse makes this a refusal.",
  };
}
