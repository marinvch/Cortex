// story-key.js — what a ticket key looks like, and where one is found in a commit or a branch.
//
// R3 of docs/specs/2026-10-25-role-packs-design.md. Two leaves need the same answer: `index/` finds
// keys in a repo's history and publishes its story links, and `mcp/` mirrors stories from the
// trackers and answers `graph story <key>`. A key the extractor writes must be a key the reader
// matches, so the rules live here, once. Pure: text in, data out, no file and no environment.
//
// Three shapes of key:
//
//   ABC-123          a Jira-style key: a project prefix, a dash, a number
//   STRY0010001      a ServiceNow story, epic or defect number (STRY, EPIC, DFCT)
//   owner/repo#45    a GitHub issue; `#45` alone when the repo is not known
//
// The rules a change must keep:
//
// - **A key in a commit message and a key in a branch name are different evidence.** The first is
//   what somebody wrote about this commit; the second is where the commit was made. `keysInMessage`
//   takes the branch name out of a merge commit's subject before it looks, so a key that only a
//   branch carries is never read as written in the message. The caller turns that into confidence:
//   `extracted` for the message, `inferred` for the branch.
// - **A pull request number is not a story.** GitHub's merge subject (`Merge pull request #12 from
//   …`) and its squash subject (`Title (#12)`) name the PR, which shares numbering with issues, and
//   so does a body line ending `(#12)`: a squash of a branch lists each PR merged into it that way.
//   Those come back as `prs`, never as keys. Found on zustand, whose v5 squash listed 20 PRs.
// - **The Jira shape is ambiguous, so known non-tickets are refused by prefix** (`STOP_PREFIXES`:
//   UTF-8, SHA-256, ISO-8601, CVE-2024, ES-2015). `prefixes`, when a caller has the team's real
//   project keys, narrows the match to them, which is the precise answer. In a branch name a key is
//   matched in upper case only, unless `prefixes` names it: `feature-2` is not `FEATURE-2`.
// - **Every list is sorted and de-duplicated**, so the extractor's output is a function of its
//   input.

/** A Jira-style project key and number. */
const JIRA = /(?<![A-Za-z0-9_])([A-Z][A-Z0-9_]{1,19})-(\d{1,9})(?![A-Za-z0-9_])/g;
/** A ServiceNow Agile number: story, epic, defect. */
const SN = /(?<![A-Za-z0-9])((?:STRY|EPIC|DFCT)\d{5,12})(?![A-Za-z0-9])/g;
/** `owner/repo#45`, a GitHub cross-repository reference. */
const GH_QUALIFIED = /(?<![\w./-])([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})#(\d{1,9})(?![\w-])/g;
/** An issue or pull request URL on GitHub or a GitHub Enterprise host. */
const GH_URL = /https?:\/\/[^\s/]+\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})\/(issues|pull)\/(\d{1,9})(?![\w-])/g;
/** `#45` or `GH-45`, a reference in the repo's own tracker. `&#45;` is an HTML entity. */
const GH_LOCAL = /(?<![\w&/#])(?:#|GH-)(\d{1,9})(?![\w-])/g;

/** Prefixes of the Jira shape that name a standard, an encoding or an advisory, never a ticket. */
export const STOP_PREFIXES = Object.freeze(new Set([
  "AES", "AGPL", "API", "ARM", "BSD", "CC", "CP", "CSS", "CVE", "CWE", "DES", "ECMA", "ES", "GH", "GMT",
  "GPL", "HTML", "HTTP", "HTTPS", "IE", "IEEE", "IPV", "ISO", "JS", "KB", "LGPL", "LTS", "MD", "MIT", "MPL",
  "MS", "NODE", "PEP", "PR", "PSR", "PY", "RFC", "RSA", "SHA", "SSL", "TLS", "TS", "UCS", "UTC", "UTF",
  "WCAG", "WIN", "X",
]));

const KEY_FORMS = [
  /^[A-Z][A-Z0-9_]{1,19}-\d{1,9}$/,
  /^(?:STRY|EPIC|DFCT)\d{5,12}$/,
  /^(?:[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})?#\d{1,9}$/,
];

/** True for a key in one of the three shapes, exactly as written. */
export function isStoryKey(key) {
  return typeof key === "string" && KEY_FORMS.some((re) => re.test(key));
}

/**
 * Where a story's mirror lives in a team-brain: `stories/<name>.md`. A Jira or ServiceNow key is
 * its own name; a GitHub key's `/` and `#` become `~`, which neither a key nor a repo name holds.
 */
export function storyFileName(key) {
  if (!isStoryKey(key)) throw new TypeError(`not a story key: ${String(key).slice(0, 60)}`);
  return key.replace(/[/#]/g, "~");
}

/** A local `#45` with the repo it belongs to: `owner/repo#45`. Any other key comes back as it was. */
export function qualifyKey(key, repo) {
  return repo && /^#\d+$/.test(key) ? `${repo}${key}` : key;
}

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (set) => [...set].sort(byCodeUnit);

function jiraOk(prefix, prefixes) {
  if (prefixes) return prefixes.has(prefix);
  return !STOP_PREFIXES.has(prefix);
}

/**
 * The branch a merge commit's subject names, or null. GitHub, GitLab and plain git each word it
 * differently; the branch is returned without the remote or the fork owner in front of it.
 */
export function mergedBranch(subject) {
  const s = String(subject ?? "");
  let m = s.match(/^Merge pull request #\d+ from [^/\s]+\/(\S+)/);
  if (m) return m[1];
  m = s.match(/^Merge remote-tracking branch '(?:[^/']+\/)?([^']+)'/);
  if (m) return m[1];
  m = s.match(/^Merge branch '([^']+)'/);
  if (m) return m[1];
  return null;
}

/**
 * The keys a commit message names, and the pull requests it names.
 *
 * `opts.repo` qualifies a local `#45` as `owner/repo#45`; `opts.prefixes` (a Set) limits the Jira
 * shape to those project keys. Returns `{ keys, prs }`, each sorted. The branch in a merge subject
 * and the PR number in a GitHub merge or squash subject are not read as keys.
 */
export function keysInMessage(message, { repo = null, prefixes = null } = {}) {
  const lines = String(message ?? "").replace(/\r\n/g, "\n").split("\n");
  const prs = new Set();
  let subject = lines[0] ?? "";
  // Merge subjects name a branch: that half is the branch's evidence, not the message's.
  const merged = mergedBranch(subject);
  const pr = subject.match(/^Merge pull request #(\d+) from /);
  if (pr) {
    prs.add(Number(pr[1]));
    subject = "";
  } else if (merged) {
    subject = "";
  }
  // GitHub's squash merge: `Title (#12)` at the end of the subject is the PR, and so is the same
  // shape at the end of a body line, where a squash of several merged PRs lists each one.
  // A revert quotes the reverted subject, PR suffix and all: `Revert "Bump x (#41)" (#42)`.
  const SQUASH = /\(#(\d{1,9})\)(?=["']?\s*(?:\(#\d{1,9}\)\s*)?$)/g;
  const body = [subject, ...lines.slice(1)].map((line) => line.replace(SQUASH, (_, n) => {
    prs.add(Number(n));
    return "";
  }));
  let text = body.join("\n");
  const keys = new Set();

  for (const m of text.matchAll(GH_URL)) {
    if (m[3] === "pull") {
      if (!repo || `${m[1]}/${m[2]}` === repo) prs.add(Number(m[4]));
    } else keys.add(`${m[1]}/${m[2]}#${m[4]}`);
  }
  text = text.replace(GH_URL, " ");
  for (const m of text.matchAll(GH_QUALIFIED)) keys.add(`${m[1]}#${m[2]}`);
  text = text.replace(GH_QUALIFIED, " ");
  for (const m of text.matchAll(GH_LOCAL)) keys.add(qualifyKey(`#${m[1]}`, repo));
  for (const m of text.matchAll(SN)) keys.add(m[1]);
  for (const m of text.matchAll(JIRA)) if (jiraOk(m[1], prefixes)) keys.add(`${m[1]}-${m[2]}`);

  // A key the message names that is also its own PR is the PR.
  for (const n of prs) keys.delete(qualifyKey(`#${n}`, repo));
  return { keys: sorted(keys), prs: [...prs].sort((a, b) => a - b) };
}

/**
 * The keys a branch name carries. Jira and ServiceNow keys in upper case, or in any case when
 * `prefixes` names the project. A GitHub issue from the branch GitHub creates for it (`45-fix-login`)
 * or from `issue-45`, `issues/45`, `gh-45`.
 */
export function keysInBranch(name, { repo = null, prefixes = null } = {}) {
  const b = String(name ?? "");
  const keys = new Set();
  for (const m of b.matchAll(SN)) keys.add(m[1]);
  for (const m of b.matchAll(JIRA)) if (jiraOk(m[1], prefixes)) keys.add(`${m[1]}-${m[2]}`);
  if (prefixes) {
    for (const m of b.matchAll(/(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9_]{1,19})-(\d{1,9})(?![A-Za-z0-9])/g)) {
      const p = m[1].toUpperCase();
      if (prefixes.has(p)) keys.add(`${p}-${m[2]}`);
    }
  }
  const leaf = b.split("/").pop();
  const gh = leaf.match(/^(\d{1,9})-[A-Za-z]/) ?? b.match(/(?:^|[/_-])(?:issues?|gh)[-_/]?(\d{1,9})(?![\d])/i);
  if (gh) keys.add(qualifyKey(`#${gh[1]}`, repo));
  return sorted(keys);
}

/**
 * `owner/repo` from a remote URL, any host, or null. Only those two names are kept, so a token in
 * the URL never reaches the caller.
 */
export function repoFromRemote(url) {
  const m = String(url ?? "").trim().match(/^(?:[a-z+]+:\/\/)?(?:[^@/\s]+@)?[^/:\s]+[/:](?:\d+\/)?([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}
