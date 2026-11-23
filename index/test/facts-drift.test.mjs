import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { factsDrift, factsDriftLines } from "../lib/facts-drift.mjs";

const temp = (p) => mkdtempSync(join(tmpdir(), p));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function put(dir, rel, text = "x\n") {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

function identify(dir) {
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
}

function commit(dir, msg) {
  git(dir, "add", ".");
  git(dir, "commit", "-qm", msg);
}

/** A remote and two clones of it, `mine` and `theirs`. */
function pair() {
  const remote = temp("drift-remote-");
  git(remote, "init", "-q", "--bare", "-b", "master");
  const theirs = temp("drift-theirs-");
  git(theirs, "clone", "-q", remote, ".");
  identify(theirs);
  git(theirs, "checkout", "-q", "-B", "master");
  put(theirs, "AGENTS.md", "# Rules\n");
  put(theirs, "src/a.js");
  commit(theirs, "seed");
  git(theirs, "push", "-q", "-u", "origin", "master");
  const mine = temp("drift-mine-");
  git(mine, "clone", "-q", remote, ".");
  identify(mine);
  return { remote, mine, theirs };
}

test("outside a git repo there is nothing to compare", () => {
  assert.equal(factsDrift(temp("drift-none-")), null);
  assert.deepEqual(factsDriftLines(null), []);
});

test("a clone level with origin has nothing to say", () => {
  const { mine } = pair();
  const d = factsDrift(mine);
  assert.equal(d.behind, 0);
  assert.deepEqual(d.files, []);
  assert.deepEqual(factsDriftLines(d), []);
});

test("a rule changed by someone else shows once it is fetched, and never fetches by itself", () => {
  const { mine, theirs } = pair();
  put(theirs, "AGENTS.md", "# Rules\n\nDone means reviewed.\n");
  put(theirs, "docs/adr/0001-a.md");
  put(theirs, "src/a.js", "changed\n");
  commit(theirs, "new rule");
  git(theirs, "push", "-q");

  assert.equal(factsDrift(mine).behind, 0, "the push is not known until a fetch");
  git(mine, "fetch", "-q");
  const d = factsDrift(mine);
  assert.equal(d.behind, 1);
  assert.deepEqual(d.files, ["AGENTS.md", "docs/adr/0001-a.md"]);
  assert.match(factsDriftLines(d)[0], /2 context file\(s\).*git pull/);
});

test("code that moved on origin is not a change of facts", () => {
  const { mine, theirs } = pair();
  put(theirs, "src/a.js", "changed\n");
  commit(theirs, "code");
  git(theirs, "push", "-q");
  git(mine, "fetch", "-q");
  const d = factsDrift(mine);
  assert.equal(d.behind, 1);
  assert.deepEqual(d.files, []);
  assert.deepEqual(factsDriftLines(d), []);
});

test("a branch's own edit to a rule is not reported as missing", () => {
  const { mine } = pair();
  git(mine, "checkout", "-q", "-b", "mine");
  put(mine, "AGENTS.md", "# Rules\n\nMy edit.\n");
  commit(mine, "edit");
  assert.deepEqual(factsDrift(mine).files, []);
});

test("a team-brain clone reports how far it is from its upstream", () => {
  const { remote, mine, theirs } = pair();
  const clone = join(mine, ".cortex", "team", "acme");
  mkdirSync(dirname(clone), { recursive: true });
  git(mine, "clone", "-q", remote, clone);
  put(theirs, "asks/q.md");
  commit(theirs, "ask");
  git(theirs, "push", "-q");
  git(clone, "fetch", "-q");
  const d = factsDrift(mine);
  assert.deepEqual(d.teams, [{ team: "acme", ahead: 0, behind: 1 }]);
  assert.match(factsDriftLines(d).join("\n"), /team-brain 'acme' is 1 commit\(s\) behind/);
});
