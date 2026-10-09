import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authorSlug, resolveAuthor, InvalidAuthorError } from "../author.js";

// Plan step 4.2. An author is a slug of CORTEX_AUTHOR when that is set, otherwise of git
// `user.name`. docs/specs/2026-10-09-team-memory-design.md, "What names an author".
//
// Git is injected in every test here. A test that asked the real git would read the identity of the
// machine it ran on: green on a laptop, red in CI, and a real name in a failure message.

// Generic on purpose: "developer A" in Cyrillic and "developer" in Chinese characters. Nobody's name.
const CYRILLIC = "Разработчик А";
const CHINESE = "开发者";

/** A git that must not be asked. */
const noGit = () => {
  throw new Error("git was asked for a name, and this test set CORTEX_AUTHOR");
};
/** A git that answers `name`, and records the directory it was asked in. */
function gitSaying(name) {
  const asked = [];
  const git = (cwd) => {
    asked.push(cwd);
    return name;
  };
  git.asked = asked;
  return git;
}

// --- the slug, row by row ------------------------------------------------------------------------

test("slug: a plain name is lower-cased and joined with a dash", () => {
  assert.equal(authorSlug("Dev A"), "dev-a");
});

test("slug: runs of spaces and punctuation collapse, and the ends are trimmed", () => {
  assert.equal(authorSlug("  Dev   A. "), "dev-a");
});

test("slug: accents are removed, not dropped with their letter", () => {
  assert.equal(authorSlug("Zoë Müller-Ångström"), "zoe-muller-angstrom");
});

test("slug: every character Windows forbids in a file name becomes a dash", () => {
  assert.equal(authorSlug('a/b\\c:d*e?f"g<h>i|j'), "a-b-c-d-e-f-g-h-i-j");
});

test("slug: a name with no ASCII letter or digit is unusable", () => {
  assert.equal(authorSlug(CYRILLIC), null, "Cyrillic only");
  assert.equal(authorSlug(CHINESE), null, "Chinese characters only");
});

test("slug: dots alone are unusable, so a name can never be a path step", () => {
  assert.equal(authorSlug(".."), null);
  assert.equal(authorSlug("."), null);
  assert.equal(authorSlug("../.."), null);
});

test("slug: a Windows device name is unusable, in any case", () => {
  assert.equal(authorSlug("CON"), null);
  for (const name of ["con", "prn", "aux", "nul", "com0", "com9", "lpt0", "lpt9", "Com1", "LPT5"]) {
    assert.equal(authorSlug(name), null, name);
  }
  // Only the whole slug is a device name. A longer one that starts the same way is an author.
  assert.equal(authorSlug("con-dev"), "con-dev");
  assert.equal(authorSlug("com10"), "com10");
});

test("slug: cut to forty characters, and a dash the cut left at the end is removed", () => {
  assert.equal(authorSlug(`${"x".repeat(60)} y`), "x".repeat(40));
  assert.equal(authorSlug(`${"x".repeat(39)} yyyy`), "x".repeat(39), "the cut fell on the dash");
  assert.equal(authorSlug(`${"x".repeat(38)} yyyy`), `${"x".repeat(38)}-y`);
});

test("slug: nothing, and things that are not a name, are unusable", () => {
  for (const v of ["", "   ", "---", null, undefined]) assert.equal(authorSlug(v), null, JSON.stringify(v));
});

test("slug: every slug is a file name the readers accept", () => {
  // The pattern list() in core/memory.js reads an author file by. A slug outside it would be
  // written and then never read back.
  const readable = /^[a-z0-9][a-z0-9-]{0,39}$/;
  for (const name of ["Dev A", "7", "a".repeat(200), "A--B__C", "x.y.z", "é", "dev-10", "-a-", "a\tb\nc"]) {
    const slug = authorSlug(name);
    assert.ok(slug !== null && readable.test(slug), `${JSON.stringify(name)} gave ${JSON.stringify(slug)}`);
  }
});

test("slug: a slug is its own slug", () => {
  for (const s of ["dev-a", "zoe-muller-angstrom", "x".repeat(40), "7"]) assert.equal(authorSlug(s), s);
});

// --- who is writing ------------------------------------------------------------------------------

test("CORTEX_AUTHOR names the author, and git is not asked", () => {
  const got = resolveAuthor({ env: { CORTEX_AUTHOR: "Dev A" }, cwd: "/repo", git: noGit });
  assert.deepEqual(got, { slug: "dev-a", source: "CORTEX_AUTHOR" });
});

test("CORTEX_AUTHOR beats git when both name someone", () => {
  const git = gitSaying("Dev B");
  const got = resolveAuthor({ env: { CORTEX_AUTHOR: "dev-a" }, cwd: "/repo", git });
  assert.equal(got.slug, "dev-a");
  assert.equal(got.source, "CORTEX_AUTHOR");
});

test("with no CORTEX_AUTHOR the author is the slug of git user.name, read in the repository", () => {
  const git = gitSaying("Dev B\n");
  const got = resolveAuthor({ env: {}, cwd: "/some/repo", git });
  assert.deepEqual(got, { slug: "dev-b", source: "git" });
  assert.deepEqual(git.asked, ["/some/repo"], "git is asked once, in the directory it was given");
});

test("an empty CORTEX_AUTHOR is an unset one", () => {
  for (const blank of ["", "   "]) {
    const got = resolveAuthor({ env: { CORTEX_AUTHOR: blank }, cwd: "/repo", git: gitSaying("Dev B") });
    assert.deepEqual(got, { slug: "dev-b", source: "git" }, JSON.stringify(blank));
  }
});

test("a CORTEX_AUTHOR that is set and unusable throws invalid_author, and git is not asked instead", () => {
  for (const bad of ["..", "CON", CYRILLIC, "***"]) {
    assert.throws(
      () => resolveAuthor({ env: { CORTEX_AUTHOR: bad }, cwd: "/repo", git: gitSaying("Dev B") }),
      (e) => e instanceof InvalidAuthorError && e.code === "invalid_author" && /CORTEX_AUTHOR/.test(e.message),
      JSON.stringify(bad),
    );
  }
});

test("no name anywhere gives slug null, and says why", () => {
  for (const nothing of [null, undefined, "", "  \n"]) {
    const got = resolveAuthor({ env: {}, cwd: "/repo", git: gitSaying(nothing) });
    assert.equal(got.slug, null, JSON.stringify(nothing));
    assert.equal(typeof got.why, "string");
    assert.match(got.why, /CORTEX_AUTHOR/, "the reason names the fix");
    assert.ok(!("source" in got), "no source when there is no author");
  }
});

test("a git that fails is no name, never an error", () => {
  const got = resolveAuthor({
    env: {},
    cwd: "/repo",
    git: () => {
      throw new Error("git: command not found");
    },
  });
  assert.equal(got.slug, null);
  assert.match(got.why, /CORTEX_AUTHOR/);
});

test("a git name with no ASCII letter or digit gives slug null, names the fix, and repeats no name", () => {
  const got = resolveAuthor({ env: {}, cwd: "/repo", git: gitSaying(CYRILLIC) });
  assert.equal(got.slug, null);
  assert.match(got.why, /CORTEX_AUTHOR/);
  assert.ok(!got.why.includes(CYRILLIC), "the raw name is never written anywhere");
  assert.ok(!got.why.includes(CYRILLIC.split(" ")[0]));
});

test("the two reasons for no author are told apart", () => {
  const none = resolveAuthor({ env: {}, cwd: "/repo", git: gitSaying(null) });
  const unusable = resolveAuthor({ env: {}, cwd: "/repo", git: gitSaying(CHINESE) });
  assert.notEqual(none.why, unusable.why);
});

test("resolveAuthor reads CORTEX_AUTHOR and git user.name, and nothing else", () => {
  // Every other variable is ignored, the root's names and an email included.
  const env = {
    CORTEX_ROOT: "/elsewhere",
    CORTEX_PROFILE: "work",
    GIT_AUTHOR_NAME: "Dev C",
    GIT_AUTHOR_EMAIL: "dev-c@example.invalid",
    EMAIL: "dev-c@example.invalid",
    USER: "dev-c",
    USERNAME: "dev-c",
  };
  const got = resolveAuthor({ env, cwd: "/repo", git: gitSaying("Dev B") });
  assert.deepEqual(got, { slug: "dev-b", source: "git" });
});

test("the module never asks git for an email, and never through a shell", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "author.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /user\.email|GIT_AUTHOR_EMAIL|GIT_COMMITTER_EMAIL/, "no email is ever read (T6)");
  assert.match(code, /execFileSync\(\s*"git",\s*\["config",\s*"user\.name"\]/, "an argument array, never a string");
  assert.doesNotMatch(code, /\bexecSync\b|\bexec\(|shell:\s*true/, "no shell");
});
