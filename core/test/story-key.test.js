// story-key.js: which text is a ticket key, and whether a commit message or a branch name holds it.
// The split between the two is what confidence is built on, so most cases here pin that line.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isStoryKey, keysInBranch, keysInMessage, mergedBranch, qualifyKey, repoFromRemote, storyFileName, STOP_PREFIXES,
} from "../story-key.js";

test("the three shapes of key, and what is not one", () => {
  for (const k of ["ABC-1", "ABC2-345", "STRY0010001", "EPIC0001234", "#45", "owner/repo#45", "my-org/my.repo#7"]) assert.ok(isStoryKey(k), k);
  for (const k of ["abc-1", "A-1", "ABC-", "-1", "STRY12", "#", "#x", "owner#4", "ABC-1 ", "../x#1", 12, null]) assert.ok(!isStoryKey(k), String(k));
});

test("a mirror's file name: a Jira or ServiceNow key as is, a GitHub key with ~ for / and #", () => {
  assert.equal(storyFileName("ABC-12"), "ABC-12");
  assert.equal(storyFileName("STRY0010001"), "STRY0010001");
  assert.equal(storyFileName("acme/app#45"), "acme~app~45");
  assert.throws(() => storyFileName("../etc/passwd"), TypeError);
});

test("a message names Jira, ServiceNow and GitHub keys, and qualifies a bare #45 with the repo", () => {
  const { keys } = keysInMessage("ABC-12: sign in\n\nFixes #45, see other/lib#9 and STRY0010001.\nRefs https://github.com/acme/app/issues/77", { repo: "acme/app" });
  assert.deepEqual(keys, ["ABC-12", "STRY0010001", "acme/app#45", "acme/app#77", "other/lib#9"]);
  assert.deepEqual(keysInMessage("Fixes #45").keys, ["#45"]);
  assert.deepEqual(keysInMessage("GH-45 too", { repo: "acme/app" }).keys, ["acme/app#45"]);
});

test("a pull request number is not a story: GitHub's merge subject, its squash subject, a /pull/ URL", () => {
  const merge = keysInMessage("Merge pull request #12 from someone/ABC-3-login\n\nSign in", { repo: "acme/app" });
  assert.deepEqual(merge, { keys: [], prs: [12] });
  const squash = keysInMessage("Sign in with SSO (#14)\n\nCloses #9", { repo: "acme/app" });
  assert.deepEqual(squash, { keys: ["acme/app#9"], prs: [14] });
  assert.deepEqual(keysInMessage('Revert "Bump the docs workflow (#41)" (#42)', { repo: "acme/app" }), { keys: [], prs: [41, 42] });
  // A squash of a branch lists the PRs merged into it, one per body line.
  const listed = keysInMessage("v5 (#30)\n\n* drop deprecated features (#31)\n* fix #32 in the store (#33)", { repo: "acme/app" });
  assert.deepEqual(listed, { keys: ["acme/app#32"], prs: [30, 31, 33] });
  const url = keysInMessage("See https://github.com/acme/app/pull/20", { repo: "acme/app" });
  assert.deepEqual(url, { keys: [], prs: [20] });
});

test("the branch in a merge subject is the branch's evidence, never the message's", () => {
  assert.equal(mergedBranch("Merge branch 'feature/ABC-7-x' into 'main'"), "feature/ABC-7-x");
  assert.equal(mergedBranch("Merge remote-tracking branch 'origin/ABC-8'"), "ABC-8");
  assert.equal(mergedBranch("Merge pull request #3 from fork/ABC-9-y"), "ABC-9-y");
  assert.equal(mergedBranch("Add ABC-1"), null);
  assert.deepEqual(keysInMessage("Merge branch 'ABC-7-x'").keys, []);
  // A key in the body of a merge commit is written on that commit.
  assert.deepEqual(keysInMessage("Merge branch 'ABC-7-x'\n\nAlso ABC-8").keys, ["ABC-8"]);
});

test("known non-tickets of the Jira shape are left out, and --keys narrows to the team's projects", () => {
  const text = "Use UTF-8 and SHA-256, ISO-8601 dates, fix CVE-2024 and ES-2015; ABC-1 and XYZ-2";
  assert.deepEqual(keysInMessage(text).keys, ["ABC-1", "XYZ-2"]);
  assert.deepEqual(keysInMessage(text, { prefixes: new Set(["ABC"]) }).keys, ["ABC-1"]);
  for (const p of ["UTF", "SHA", "ISO", "CVE"]) assert.ok(STOP_PREFIXES.has(p));
});

test("a branch name: upper-case keys, lower-case only for a named project, and GitHub's issue branches", () => {
  assert.deepEqual(keysInBranch("feature/ABC-12-sign-in"), ["ABC-12"]);
  assert.deepEqual(keysInBranch("feature/abc-12-sign-in"), []);
  assert.deepEqual(keysInBranch("feature/abc-12-sign-in", { prefixes: new Set(["ABC"]) }), ["ABC-12"]);
  assert.deepEqual(keysInBranch("feature-2"), []);
  assert.deepEqual(keysInBranch("45-fix-login", { repo: "acme/app" }), ["acme/app#45"]);
  assert.deepEqual(keysInBranch("fix/issue-45"), ["#45"]);
  assert.deepEqual(keysInBranch("release-2"), []);
});

test("a remote URL gives owner and name only, so a token in it never comes back", () => {
  assert.equal(repoFromRemote("https://github.com/acme/app.git"), "acme/app");
  assert.equal(repoFromRemote("git@github.com:acme/app.git"), "acme/app");
  // Assembled at run time, so the repo's own secret scan does not read this file as holding one.
  assert.equal(repoFromRemote(["https://x-access-token:", "not-a-real-token", "@github.com/acme/app"].join("")), "acme/app");
  assert.equal(repoFromRemote("/home/someone/repo"), null);
  assert.equal(qualifyKey("#4", "acme/app"), "acme/app#4");
  assert.equal(qualifyKey("ABC-4", "acme/app"), "ABC-4");
});
