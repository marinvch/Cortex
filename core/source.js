// source.js — where Cortex comes from, for the files a team commits that name it.
//
// Many organisations allow agent plugins only from a repository they host and review, so they run
// Cortex from a fork (`acme/cortex`). Two things Cortex stamps into a team's repos name the place
// Cortex is fetched from: the marketplace entry in `.claude/settings.json`
// (`index/lib/shared-plugin.mjs`) and the clone in CI (`templates/loop/cortex-review.yml`). Both ask
// this module, so a fork names itself in both or in neither (#622).
//
// One value, three spellings, and the three marketplace source shapes Claude Code documents
// (code.claude.com/docs/en/settings-reference, "Allowed source types"):
//
//   owner/repo                                → { source: "github", repo }
//   https://… · ssh://… · git@host:path       → { source: "git", url }
//   an absolute local path                    → { source: "directory", path }
//
// Anything else is refused with a sentence, and so is a URL that carries a credential: the value is
// committed into a team's settings and workflow, and a token there is a token published. The check
// is `carriesCredential` (`project-file.js`), the one a project file's repo link already passes, so
// the two never disagree about what a credential looks like. No message here repeats a refused
// value that carries one.
//
// Which value answers is ordered once, in `resolveSource`: an explicit argument, then the
// `CORTEX_SOURCE` environment variable, then the `source` field of the repo's
// `.cortex/connector.json` (written by `team add` from the team-brain's `team.json`), then the
// default, `marinvch/Cortex`. An empty or blank value is unset, as `rootFromEnv` (`paths.js`) reads
// the root. The default's marketplace entry is byte-for-byte the one Cortex wrote before this
// module existed, so a team that never sets anything sees no change.

import { readFileSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import { carriesCredential } from "./project-file.js";

export const SOURCE_VAR = "CORTEX_SOURCE";
export const DEFAULT_SOURCE = "marinvch/Cortex";
export const CONNECTOR_REL = ".cortex/connector.json";

/** A source Cortex will not write into a team's files. `code` lets a caller tell it from a bug. */
export class SourceRefused extends Error {
  constructor(message) {
    super(message);
    this.name = "SourceRefused";
    this.code = "source_refused";
  }
}

const named = (v) => String(v ?? "").trim();

// GitHub's own rules: an owner is letters, digits and single dashes; a repository name is letters,
// digits, `.`, `_` and `-`, and is never `.` or `..`.
const GITHUB_RE = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;
const SCP_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/;
const URL_RE = /^(https|ssh):\/\/[^\s/]+\/[^\s]+$/i;

/** The value quoted for a message, shortened — only ever called on a value with no credential. */
const quote = (v) => JSON.stringify(v.length > 80 ? `${v.slice(0, 80)}…` : v);

/**
 * The marketplace source object for one spelling of a source. Throws `SourceRefused` for anything
 * that is not one of the three shapes, and for a URL carrying a password or a token.
 *
 * @param {string} text
 * @param {string} [from] where the value came from, for the message — `--source`, `CORTEX_SOURCE`…
 * @returns {{ source: "github", repo: string } | { source: "git", url: string } | { source: "directory", path: string }}
 */
export function parseSource(text, from = "the source") {
  const v = named(text);
  if (!v) throw new SourceRefused(`${from} is empty; give an owner/repo, a git URL or an absolute path`);
  if (/[\s\u0000-\u001f\u007f]/.test(v)) {
    throw new SourceRefused(`${from} holds whitespace or a control character; a source is one owner/repo, git URL or path`);
  }
  if (carriesCredential(v)) {
    throw new SourceRefused(
      `${from} carries a credential (a password or a token), and the source is committed into a team's files. ` +
        "Give the repository's plain address and let git's own credential helper sign in.",
    );
  }

  const gh = GITHUB_RE.exec(v);
  if (gh) {
    if (gh[2] === "." || gh[2] === "..") throw new SourceRefused(`${from} ${quote(v)} names no repository`);
    return { source: "github", repo: v };
  }
  if (URL_RE.test(v) || SCP_RE.test(v)) return { source: "git", url: v };
  // An absolute path on either platform: `/srv/cortex`, `C:\\cortex`, `C:/cortex`, `\\\\host\\share`.
  if (posix.isAbsolute(v) || (win32.isAbsolute(v) && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(v))) {
    return { source: "directory", path: v };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
    throw new SourceRefused(`${from} ${quote(v)} is a URL Cortex does not clone from; use https:// or ssh://, or the git@host:path form`);
  }
  if (/^\.{1,2}(?:[\\/]|$)/.test(v) || v.includes("\\") || v.split("/").length > 2) {
    throw new SourceRefused(`${from} ${quote(v)} is a relative path; a local marketplace is named by its absolute path`);
  }
  throw new SourceRefused(`${from} ${quote(v)} is not an owner/repo, a git URL (https://, ssh://, git@host:path) or an absolute path`);
}

/** The default source's marketplace object, as Cortex wrote it before sources were configurable. */
export const DEFAULT_MARKETPLACE_SOURCE = Object.freeze(parseSource(DEFAULT_SOURCE));

/** Is this marketplace source object the default one? */
export function isDefaultSource(source) {
  return source?.source === "github" && source.repo === DEFAULT_SOURCE;
}

/**
 * The URL CI clones Cortex from: `https://github.com/<repo>.git` for a GitHub source, the URL itself
 * for a git source, and `null` for a directory — a runner cannot clone a path on someone's machine,
 * so the caller says so rather than stamping a workflow that fails on its first run.
 */
export function cloneUrl(source) {
  if (source?.source === "github") return `https://github.com/${source.repo}.git`;
  if (source?.source === "git") return source.url;
  if (source?.source === "directory") return null;
  throw new TypeError(`cloneUrl: not a marketplace source: ${JSON.stringify(source)}`);
}

/**
 * The `source` field of a repo's `.cortex/connector.json`, as written, or null: no connector, one
 * that does not parse, or one with no `source`. This only reads; `resolveSource` validates it.
 */
export function connectorSource(repoRoot) {
  let text;
  try {
    text = readFileSync(join(repoRoot, ...CONNECTOR_REL.split("/")), "utf8");
  } catch {
    return null;
  }
  try {
    const c = JSON.parse(text);
    return typeof c?.source === "string" && c.source.trim() ? c.source : null;
  } catch {
    return null;
  }
}

/**
 * Which source answers, and from where. The ONE place the order is held:
 * `argument` > `CORTEX_SOURCE` > the connector's `source` > the default. Empty or blank is unset at
 * every step. A value that is set and wrong is refused (`SourceRefused`), never skipped for the next
 * one down — a fork that misspelt its source must not quietly get upstream.
 *
 * @param {{ argument?: string|null, env?: Record<string, string|undefined>, connector?: string|null }} [inputs]
 * @returns {{ text: string, from: "argument"|"CORTEX_SOURCE"|"connector"|"default", source: object, isDefault: boolean }}
 */
export function resolveSource({ argument = null, env = {}, connector = null } = {}) {
  const steps = [
    ["argument", argument, "--source"],
    [SOURCE_VAR, env?.[SOURCE_VAR], SOURCE_VAR],
    ["connector", connector, `the source in ${CONNECTOR_REL}`],
  ];
  for (const [from, value, label] of steps) {
    const text = named(value);
    if (!text) continue;
    const source = parseSource(text, label);
    return { text, from, source, isDefault: isDefaultSource(source) };
  }
  return { text: DEFAULT_SOURCE, from: "default", source: { ...DEFAULT_MARKETPLACE_SOURCE }, isDefault: true };
}
