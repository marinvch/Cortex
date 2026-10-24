// The employer denylist: the part of the `home` firewall a machine can check.
//
// ADR 0015 says employer content cannot be detected, and that stays true: nothing in Cortex can
// tell, from a sentence, that it is about somebody's day job. What a machine CAN do is recognise
// names the person told it about. So the person keeps a list — their employer's and clients' names,
// domains, ticket-key prefixes and repo owners — in one file outside every repository, and on a
// `home` profile every published write whose text carries one of them is refused. The list is the
// person's knowledge; matching it is the code's job. docs/adr/0026 holds the argument.
//
// The rules this module keeps:
//
//   - **The file lives outside any repository.** `CORTEX_DENYLIST` names it, else
//     `~/.cortex/employer-denylist`. A denylist committed anywhere is itself the leak: it is a list of
//     exactly the names the firewall exists to keep out.
//   - **No file is no check, and is said so.** The default path missing means nobody set one up;
//     `loadDenylist` returns `state: "absent"`, and preflight prints that the denylist is empty. A
//     `CORTEX_DENYLIST` that is set and names no readable file is different: somebody asked for a
//     list and is not getting it, so `state` is `"missing"` and the gate refuses. A typo must not
//     switch the firewall off quietly — the argument ADR 0015 makes for an unknown profile.
//   - **A bad line is reported, never fatal.** A regular expression that does not compile, an
//     unknown kind or an empty value is a `problem` with its line number. The good lines still apply.
//   - **A refusal never repeats the text it matched**, and never the entry either. It names the
//     entry's kind and its line in the denylist; the person has the file and can look.
//   - **Only `home` applies it.** The gate reads `policy.refuses` and nothing else, like
//     `profileRefusal` in project-file.js: `work` expects employer material, and `lab` publishes
//     nothing (ADR 0015). No profile name and no environment variable decides it here.

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RefusedWriteError } from "./scrub.js";

/** What a line may name. `ticket` and `pattern` are regular expressions; the rest are literal. */
export const DENYLIST_KINDS = Object.freeze(["org", "domain", "owner", "ticket", "pattern"]);

const DESCRIBE = {
  org: "an organisation name",
  domain: "a domain",
  owner: "a repository owner",
  ticket: "a ticket key",
  pattern: "a pattern",
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One line's regular expression, or a problem. Literal kinds are matched case-insensitively and only
 * as whole words, so `acme` refuses "Acme Corp" and not "acmeist". A domain also refuses its
 * subdomains and an address at it; an owner treats `-` and `_` as part of the name, as a forge does.
 */
function compile(kind, value) {
  const lit = escape(value).replace(/\s+/g, "\\s+");
  switch (kind) {
    case "org":
      return new RegExp(`(?<![\\p{L}\\p{N}])${lit}(?![\\p{L}\\p{N}])`, "giu");
    case "owner":
      return new RegExp(`(?<![\\p{L}\\p{N}_-])${lit}(?![\\p{L}\\p{N}_-])`, "giu");
    case "domain":
      // A preceding `.` is a subdomain and `@` an address, so both still match. What follows may
      // not continue the name: `corp.example` refuses `mail.corp.example` and not `corp.examples`
      // or `corp.example.org`.
      return new RegExp(`(?<![\\p{L}\\p{N}-])${lit}(?![\\p{L}\\p{N}-]|\\.[\\p{L}\\p{N}])`, "giu");
    case "ticket":
      // Case-sensitive: a key is upper case by convention, and `acme-1` in prose is not one.
      return new RegExp(`(?<![A-Za-z0-9])(?:${value})(?![A-Za-z0-9])`, "g");
    case "pattern":
      return new RegExp(value, "gi");
    default:
      return null;
  }
}

/**
 * Parse a denylist's text. Returns `{ entries: [{ kind, line, re }], problems: [{ line, why }] }`.
 * Never throws: a line that cannot be used is a problem, and the others still apply.
 *
 *   # comment
 *   org: Example Corp
 *   domain: corp.example
 *   owner: example-corp
 *   ticket: EXC-\d+
 *   pattern: project\s+bluebird
 */
export function parseDenylist(text) {
  const entries = [];
  const problems = [];
  String(text ?? "").split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (!s || s.startsWith("#")) return;
    const colon = s.indexOf(":");
    if (colon < 0) {
      problems.push({ line, why: `has no kind — write it as one of ${DENYLIST_KINDS.join(", ")}, a colon, then the value` });
      return;
    }
    const kind = s.slice(0, colon).trim().toLowerCase();
    const value = s.slice(colon + 1).trim();
    if (!DENYLIST_KINDS.includes(kind)) {
      problems.push({ line, why: `names an unknown kind — expected one of ${DENYLIST_KINDS.join(", ")}` });
      return;
    }
    if (!value) {
      problems.push({ line, why: "has no value" });
      return;
    }
    let re;
    try {
      re = compile(kind, value);
    } catch {
      problems.push({ line, why: "is not a valid regular expression, so it is skipped" });
      return;
    }
    // A pattern that matches empty text matches every write, which would refuse everything and say
    // nothing useful about why.
    re.lastIndex = 0;
    if (re.test("")) {
      problems.push({ line, why: "matches empty text, so it would refuse every write — it is skipped" });
      return;
    }
    entries.push({ kind, line, re });
  });
  return { entries, problems };
}

/** The denylist's path, and which setting named it. Reads the strings it is handed, never the disk. */
export function denylistPath({ env = {} } = {}) {
  const set = String(env.CORTEX_DENYLIST ?? "").trim();
  if (set) return { path: set, from: "CORTEX_DENYLIST" };
  const home = String(env.HOME ?? "").trim() || String(env.USERPROFILE ?? "").trim() || homedir();
  return { path: join(home, ".cortex", "employer-denylist"), from: "default" };
}

/**
 * Read the denylist. `{ path, from, state, entries, problems }`, where `state` is
 *
 *   read       the file was read; `entries` and `problems` say what it holds
 *   absent     no file at the default path — nothing is checked, and preflight says the list is empty
 *   missing    CORTEX_DENYLIST names no readable file — the gate refuses rather than check nothing
 *
 * Never throws.
 */
export function loadDenylist({ env = {} } = {}) {
  const { path, from } = denylistPath({ env });
  let text;
  try {
    if (!statSync(path).isFile()) throw new Error("not a file");
    text = readFileSync(path, "utf8");
  } catch {
    const state = from === "CORTEX_DENYLIST" ? "missing" : "absent";
    return { path, from, state, entries: [], problems: [] };
  }
  return { path, from, state: "read", ...parseDenylist(text) };
}

/** Every entry the text matches, as `[{ kind, line }]` — the entry's line in the denylist. */
export function matchDenylist(text, list) {
  const src = String(text ?? "");
  const hits = [];
  for (const { kind, line, re } of list?.entries ?? []) {
    re.lastIndex = 0;
    if (re.test(src)) hits.push({ kind, line });
  }
  return hits;
}

/** A published write refused by the employer denylist. Names the entry's kind and line, never text. */
export class DeniedWriteError extends RefusedWriteError {
  constructor(hits, { missing = false } = {}) {
    super(hits.map((h) => ({ kind: `employer denylist entry (${h.kind})`, line: h.line })));
    this.name = "DeniedWriteError";
    this.code = "employer_denylist";
    this.hits = hits;
    this.message = missing
      ? "refusing to publish: CORTEX_DENYLIST is set and names no readable file, so the employer " +
        "check cannot run. Fix the path, or unset CORTEX_DENYLIST to use ~/.cortex/employer-denylist."
      : `refusing to publish: the text matches ${hits
          .map((h) => `line ${h.line} of your employer denylist (${DESCRIBE[h.kind]})`)
          .join(", ")}. This install's profile is home, which refuses employer material. ` +
        "Nothing was written. Keep it in a work install or in the work repo's own context layer.";
  }
}

/**
 * The gate. On a profile whose policy refuses employer material, throw `DeniedWriteError` when the
 * text matches the denylist; otherwise return `{ applied, problems }` so a caller can pass on what
 * was wrong with the list. A missing policy throws: it is never read as "refuses nothing".
 *
 * `list` is for a caller that already loaded the denylist and for tests; without it the file is read.
 */
export function assertNotDenied(text, { policy, env = process.env, list } = {}) {
  if (!policy || typeof policy.refuses !== "string") throw new TypeError("assertNotDenied: a profile policy is required");
  if (policy.refuses !== "employer") return { applied: false, problems: [] };
  const l = list ?? loadDenylist({ env });
  if (l.state === "missing") throw new DeniedWriteError([], { missing: true });
  const hits = matchDenylist(text, l);
  if (hits.length) throw new DeniedWriteError(hits);
  return { applied: l.state === "read", problems: l.problems };
}

/** One sentence per problem, for a caller to pass on. Never repeats the line's text. */
export function denylistProblemNotes(problems) {
  return (problems ?? []).map((p) => `employer denylist line ${p.line} ${p.why}.`);
}
