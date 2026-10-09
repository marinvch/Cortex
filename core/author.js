import { execFileSync } from "node:child_process";

// Who is writing memory. core/memory.js writes one file per author per day, `<date>/<author>.md`,
// and this module answers what `<author>` is: a slug of CORTEX_AUTHOR when that is set, otherwise a
// slug of git `user.name`. docs/specs/2026-10-09-team-memory-design.md, "What names an author".
//
// Three rules hold here and nowhere else:
//
//   - Only a name is read, never an email address, and only its slug is ever written. A path is in
//     every checkout and every archive of the tree, and memory is committed.
//   - A CORTEX_AUTHOR someone set and got wrong is refused, the way CORTEX_PROFILE is. Falling back
//     to git would put their entries under a name they chose not to publish.
//   - No name at all is not an error. The caller writes the day file and says so.
//
// This is the one module in core/ that starts a process. It does because the writer, not each of
// its callers, must know the author: a caller that had to pass one would be a caller that forgot
// (ADR 0016). `git` is injectable, so no test needs git or reads the identity of its machine.

const MAX_SLUG = 40;

// Windows device names. Node wrote `con.md` as an ordinary file on Windows 11; older versions are
// said to refuse it, which was not tested, so the names are excluded.
const DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/**
 * The slug of a name, or `null` when the name gives none.
 *
 * A slug is `a-z`, `0-9` and `-`, starts with a letter or a digit, and is at most 40 characters:
 * the pattern `list()` in core/memory.js reads an author file by. It holds no `.`, `/` or `\`, so
 * it can neither leave the day directory nor be read as a date.
 */
export function authorSlug(name) {
  if (typeof name !== "string") return null;
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // combining marks, so an accented letter keeps its letter
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, ""); // the cut can land on a dash
  if (!slug || DEVICE_NAME.test(slug)) return null;
  return slug;
}

export class InvalidAuthorError extends Error {
  constructor(source) {
    super(
      `${source} is set, and no author name can be made from it. ` +
        "An author is written as a-z, 0-9 and -, at most 40 characters, and is not a Windows device name " +
        "(con, nul, com1, ...). Set CORTEX_AUTHOR to a short handle such as dev-a. Nothing was written.",
    );
    this.name = "InvalidAuthorError";
    this.code = "invalid_author";
    this.source = source;
  }
}

/** `git config user.name` in `cwd`, or `null`. An argument array, never a shell string. */
function gitUserName(cwd) {
  try {
    return execFileSync("git", ["config", "user.name"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: 5000,
    });
  } catch {
    return null; // no git, not a repository with a name, no name set
  }
}

/**
 * resolveAuthor({ env, cwd, git })
 *   -> { slug, source: "CORTEX_AUTHOR" | "git" }
 *   -> { slug: null, why }     no usable name; `why` is a sentence for a person and names the fix
 *   throws InvalidAuthorError  CORTEX_AUTHOR is set and gives no slug
 *
 * `cwd` is the repository: the parent of `.cortex`. `git(cwd)` returns the name or nothing, and may
 * throw; both mean no name. An empty CORTEX_AUTHOR is an unset one. `why` never repeats a name.
 */
export function resolveAuthor({ env = {}, cwd, git = gitUserName } = {}) {
  const declared = env.CORTEX_AUTHOR;
  if (declared !== undefined && declared !== null && String(declared).trim() !== "") {
    const slug = authorSlug(String(declared));
    if (slug === null) throw new InvalidAuthorError("CORTEX_AUTHOR");
    return { slug, source: "CORTEX_AUTHOR" };
  }

  let name = null;
  try {
    name = git(cwd);
  } catch {
    name = null;
  }
  if (typeof name !== "string" || name.trim() === "") {
    return { slug: null, why: "git has no user.name here and CORTEX_AUTHOR is not set" };
  }
  const slug = authorSlug(name);
  if (slug === null) {
    return {
      slug: null,
      why: "the git user.name has no ASCII letter or digit to make a file name from, and CORTEX_AUTHOR is not set",
    };
  }
  return { slug, source: "git" };
}
