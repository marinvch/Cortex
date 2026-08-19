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
