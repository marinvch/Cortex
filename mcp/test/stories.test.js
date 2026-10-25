// Stories (R3 and R4 of docs/specs/2026-10-25-role-packs-design.md): the tracker mirror, the
// published story links, the graph's story ops, and a team named without a connector.
//
// Trackers are local `node:http` servers answering in each vendor's documented shapes, as in
// tracker-mocks.js; no test reaches a real tracker. Every fixture name is generic.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stamp } from "../../core/date.js";
import { policyFor } from "../../core/profile.js";
import { OutsideRootError } from "../../core/paths.js";
import { RefusedWriteError } from "../../core/scrub.js";
import { openBrain } from "../lib/brain.js";
import { resolveBrain } from "../lib/resolve.js";
import { syncFrom } from "../lib/sync.js";
import { assigneeFor, mirrorStories } from "../lib/stories.js";
import { FIELDS, parseStory, renderStory, normaliseStory } from "../lib/story-file.js";
import { parseStoryLinks, publishStoryLinks, StoryLinksRefused } from "../lib/story-links.js";
import { adapterFor, parseIntegrations, integrationsFromFlags } from "../lib/integrations.js";
import { tempDir } from "./tmp.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "ai-os.js");
const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const TODAY = stamp();
const DESCRIPTION = "DESCRIPTION-MUST-NOT-LEAVE-THE-TRACKER";
const creds = (extra = {}) => ({ GITHUB_TOKEN: "test-token-gh", JIRA_EMAIL: "bot@example.com", JIRA_API_TOKEN: "test-token-jira", SERVICENOW_TOKEN: "test-token-sn", ...extra });

function git(cwd, ...a) {
  return execFileSync("git", a, { cwd, env: { ...process.env, ...IDENTITY }, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

// --- a mock tracker -------------------------------------------------------------------------------

const servers = [];
after(async () => { for (const s of servers) await new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); }); });

/** A local server: `handle({ method, path, query })` → `[status, json]`. Records every request. */
async function mock(handle) {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const rec = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization ?? "" };
    requests.push(rec);
    const [status, json] = rec.auth ? handle(rec) : [401, { message: "no auth" }];
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(json));
  });
  servers.push(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

/** GitHub issues: two open, one closed, one epic, one pull request, one of Cortex's own asks. */
function githubIssues() {
  const issue = (number, title, extra = {}) => ({
    number, title, body: DESCRIPTION, state: "open", state_reason: null, labels: [], assignees: [],
    html_url: `https://github.com/acme/web-a/issues/${number}`, updated_at: "2026-10-20T00:00:00Z", ...extra,
  });
  return [
    issue(1, "Checkout flow", { labels: [{ name: "Epic" }] }),
    issue(2, "Pay by card", { assignees: [{ login: "dev-fe" }] }),
    issue(3, "Receipt email", { state: "closed", state_reason: "completed", assignees: [{ login: "outside-person" }] }),
    issue(4, "A pull request", { pull_request: { url: "x" } }),
    issue(5, "Which API version? [ask:20261020-abc]"),
  ];
}
const mockGitHub = (issues = githubIssues()) => mock((r) => {
  const m = r.path.match(/^\/repos\/acme\/web-a\/issues$/);
  if (!m) return [200, []];
  return [200, issues.filter((i) => r.query.state === "all" || i.state === r.query.state)];
});

const mockJira = (issues) => mock((r) => {
  if (r.path !== "/rest/api/3/search/jql") return [404, {}];
  return [200, { issues }];
});

const jiraIssue = (key, summary, { type = "Story", cat = "new", status = "To Do", parent = null, assignee = null, labels = [] } = {}) => ({
  key, fields: { summary, description: DESCRIPTION, status: { name: status, statusCategory: { key: cat } }, issuetype: { name: type }, parent: parent ? { key: parent } : null, assignee: assignee ? { displayName: assignee } : null, labels },
});

// --- a team-brain on a bare remote ----------------------------------------------------------------

const MEMBERS = [{ handle: "dev-fe", roles: ["frontend"], projects: ["web-a"], github: "dev-fe" }];

function brainRemote(teamJson) {
  const remote = tempDir("sto-remote-");
  git(remote, "init", "--bare", "-q", "-b", "master");
  const seed = tempDir("sto-seed-");
  git(seed, "clone", "-q", remote, ".");
  mkdirSync(join(seed, "projects"), { recursive: true });
  writeFileSync(join(seed, "projects", "web-a.md"), "---\ntype: project\ntitle: Web A\nrepo: https://github.com/acme/web-a\ncreated: 2026-10-01\n---\n");
  writeFileSync(join(seed, "team.json"), JSON.stringify({ members: MEMBERS, ...teamJson }, null, 2) + "\n");
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "seed");
  git(seed, "branch", "-M", "master");
  git(seed, "push", "-q", "-u", "origin", "master");
  return remote;
}
function checkout(remote) {
  const dir = tempDir("sto-ci-");
  git(dir, "clone", "-q", remote, ".");
  return dir;
}
function ciBrain(profile = "work", env = {}) {
  const root = tempDir("sto-ciroot-");
  return openBrain({ cwd: root, env: { CORTEX_ROOT: root, CORTEX_PROFILE: profile, ...env } });
}
const remoteFile = (remote, rel) => git(remote, "show", `master:${rel}`);
const remoteHas = (remote, rel) => { try { remoteFile(remote, rel); return true; } catch { return false; } };

// ---------------------------------------------------------------------------------------------
// R3: the mirror
// ---------------------------------------------------------------------------------------------

test("the mirror writes key, title, status, assignee, epic and link from GitHub and Jira, and never a description", async () => {
  const gh = await mockGitHub();
  const jira = await mockJira([
    jiraIssue("ABC-1", "Checkout", { type: "Epic", cat: "indeterminate", status: "In Progress" }),
    jiraIssue("ABC-2", "Pay by card", { parent: "ABC-1", cat: "indeterminate", status: "In Progress", assignee: "dev-fe" }),
    jiraIssue("ABC-9", "Own ask", { labels: ["cortex-ask-x"] }),
  ]);
  const remote = brainRemote({ integrations: [
    { kind: "github", api: gh.url, repo: "acme/web-a", stories: true },
    { kind: "jira", site: jira.url, project: "ABC", stories: true },
  ] });
  const run = await syncFrom(ciBrain("work"), { clone: checkout(remote) }, { env: creds(), today: TODAY });
  assert.equal(run.committed, true, JSON.stringify(run));
  assert.match(run.message, /stories 5 written/);

  const issue2 = parseStory(remoteFile(remote, "stories/acme~web-a~2.md"));
  assert.deepEqual(issue2, { type: "story", key: "acme/web-a#2", kind: "story", title: "Pay by card", status: "open", state: "open", epic: null, assignee: "dev-fe", tracker: "github", url: "https://github.com/acme/web-a/issues/2" });
  assert.equal(parseStory(remoteFile(remote, "stories/acme~web-a~1.md")).kind, "epic");
  assert.equal(parseStory(remoteFile(remote, "stories/acme~web-a~3.md")).status, "done");
  const abc2 = parseStory(remoteFile(remote, "stories/ABC-2.md"));
  assert.equal(abc2.epic, "ABC-1");
  assert.equal(abc2.status, "active");

  // Pull requests and Cortex's own ask items are not stories.
  assert.ok(!remoteHas(remote, "stories/acme~web-a~4.md"));
  assert.ok(!remoteHas(remote, "stories/acme~web-a~5.md"));
  assert.ok(!remoteHas(remote, "stories/ABC-9.md"));
  // No description, anywhere in the history.
  assert.ok(!git(remote, "log", "-p", "--all").includes(DESCRIPTION));
  // The file holds exactly the documented fields.
  const keys = remoteFile(remote, "stories/ABC-2.md").split("---")[1].trim().split("\n").map((l) => l.split(":")[0]);
  assert.ok(keys.every((k) => FIELDS.includes(k)), keys.join(","));

  // A second run learns nothing and commits nothing.
  const head = git(remote, "rev-parse", "master").trim();
  const again = await syncFrom(ciBrain("work"), { clone: checkout(remote) }, { env: creds(), today: TODAY });
  assert.equal(again.committed, false, JSON.stringify(again));
  assert.equal(git(remote, "rev-parse", "master").trim(), head);
});

test("on work, the personal-data mode refuses: only a roster member's assignee is written, by handle", async () => {
  const gh = await mockGitHub();
  const remote = brainRemote({ integrations: [{ kind: "github", api: gh.url, repo: "acme/web-a", stories: true }] });
  const run = await syncFrom(ciBrain("work"), { clone: checkout(remote) }, { env: creds(), today: TODAY });
  assert.equal(run.stories.assigneesWithheld, 1, JSON.stringify(run.stories));
  assert.equal(parseStory(remoteFile(remote, "stories/acme~web-a~2.md")).assignee, "dev-fe");
  assert.equal(parseStory(remoteFile(remote, "stories/acme~web-a~3.md")).assignee, null);
  assert.ok(!git(remote, "log", "-p", "--all").includes("outside-person"));
});

test("on home, assignees are written as the tracker shows them, with one warning saying so", async () => {
  const gh = await mockGitHub();
  const remote = brainRemote({ integrations: [{ kind: "github", api: gh.url, repo: "acme/web-a", stories: true }] });
  const run = await syncFrom(ciBrain("home"), { clone: checkout(remote) }, { env: creds({ CORTEX_DENYLIST: join(tempDir("sto-nodeny-"), "none") }), today: TODAY });
  // A CORTEX_DENYLIST naming no file refuses every publish on home: that is the denylist's rule.
  assert.ok(run.stories.withheld.length > 0);
  const ok = await syncFrom(ciBrain("home"), { clone: checkout(remote) }, { env: creds({ HOME: tempDir("sto-home-"), USERPROFILE: tempDir("sto-home-") }), today: TODAY });
  assert.equal(parseStory(remoteFile(remote, "stories/acme~web-a~3.md")).assignee, "outside-person");
  assert.match(ok.stories.warnings[0], /personal data: 2 mirrored stories name their assignee/);
});

test("on home, a key the employer denylist names is refused, and so is a title naming the employer", async () => {
  const jira = await mockJira([
    jiraIssue("ABC-1", "Plain title"),
    jiraIssue("ABC-2", "Plain title too"),
  ]);
  const gh = await mockGitHub([{ number: 7, title: "Integrate with Examplecorp billing", body: "", state: "open", labels: [], assignees: [], html_url: "https://github.com/acme/web-a/issues/7" },
    { number: 8, title: "Fine", body: "", state: "open", labels: [], assignees: [], html_url: "https://github.com/acme/web-a/issues/8" }]);
  const remote = brainRemote({ integrations: [
    { kind: "jira", site: jira.url, project: "ABC", stories: true },
    { kind: "github", api: gh.url, repo: "acme/web-a", stories: true },
  ] });
  const list = join(tempDir("sto-deny-"), "employer-denylist");
  writeFileSync(list, "ticket: ABC-\\d+\norg: Examplecorp\n");
  const run = await syncFrom(ciBrain("home"), { clone: checkout(remote) }, { env: creds({ CORTEX_DENYLIST: list }), today: TODAY });
  assert.deepEqual(run.stories.withheld.map((w) => `${w.tracker}:${w.field}:${w.code}`).sort(),
    ["github:story:employer_denylist", "jira:key:employer_denylist", "jira:key:employer_denylist"]);
  const history = git(remote, "log", "-p", "--all");
  assert.ok(!history.includes("ABC-1") && !history.includes("Examplecorp"));
  assert.ok(remoteHas(remote, "stories/acme~web-a~8.md"));
  assert.ok(!JSON.stringify(run).includes("ABC-1"), "a refusal never names the key");
});

test("on work, a tracker host that is not an approved destination is never called", async () => {
  const dests = join(tempDir("sto-dest-"), "allowed-destinations");
  writeFileSync(dests, "https: approved.example.test\n");
  const remote = brainRemote({ integrations: [{ kind: "jira", site: "https://tracker.example.test", project: "ABC", stories: true }] });
  const calls = [];
  const fetch = async (url) => { calls.push(url); throw new Error("the network was reached"); };
  const run = await syncFrom(ciBrain("work"), { clone: checkout(remote) }, { env: creds({ CORTEX_DESTINATIONS: dests }), today: TODAY, fetch });
  assert.deepEqual(calls, []);
  assert.match(run.stories.errors.jira, /^unapproved_destination: refusing to reach tracker\.example\.test/);
  assert.equal(run.committed, false);
});

test("the mirror needs stories: true, and never runs on lab", async () => {
  const gh = await mockGitHub();
  const off = brainRemote({ integrations: [{ kind: "github", api: gh.url, repo: "acme/web-a" }] });
  const a = await syncFrom(ciBrain("work"), { clone: checkout(off) }, { env: creds(), today: TODAY });
  assert.equal(a.stories.reason, "no_story_integrations");
  const before = gh.requests.length;
  const on = brainRemote({ integrations: [{ kind: "github", api: gh.url, repo: "acme/web-a", stories: true }] });
  const lab = await syncFrom(ciBrain("lab"), { clone: checkout(on) }, { env: creds(), today: TODAY });
  assert.equal(lab.ran, false);
  assert.equal(gh.requests.length, before);
});

test("integrations take stories as true or false, and storyTypes as names with no quote", () => {
  assert.equal(parseIntegrations({ integrations: [{ kind: "github", repo: "acme/app", stories: true }] }).integrations[0].stories, true);
  assert.throws(() => parseIntegrations({ integrations: [{ kind: "github", stories: "yes" }] }), /true or false/);
  assert.throws(() => parseIntegrations({ integrations: [{ kind: "jira", site: "https://t.example.test", project: "ABC", storyTypes: ['Story" OR 1=1'] }] }), /no quote/);
  const f = integrationsFromFlags({ integrations: "github,jira", "jira-site": "https://t.example.test", "jira-project": "ABC", stories: "jira" });
  assert.deepEqual(f.integrations.map((i) => [i.kind, i.stories ?? false]), [["github", false], ["jira", true]]);
  assert.throws(() => integrationsFromFlags({ integrations: "github", stories: "jira" }), /not a selected integration/);
});

test("a story file: one line per value, a URL with credentials dropped, and parse(render(x)) is x", () => {
  const s = normaliseStory({ key: "ABC-3", kind: "story", title: "Line one\nkey: injected", status: "weird", url: ["https://user:", "pw", "@tracker.example.test/x"].join("") }, "jira");
  assert.equal(s.title, "Line one key: injected");
  assert.equal(s.status, "open");
  assert.equal(s.url, null);
  assert.deepEqual(parseStory(renderStory(s)), { ...s, state: null, epic: null, assignee: null });
  assert.equal(normaliseStory({ key: "not a key" }, "jira"), null);
  assert.deepEqual(assigneeFor("Someone", { mode: "refuse", members: MEMBERS }), { value: null, withheld: true });
  assert.deepEqual(assigneeFor("DEV-FE", { mode: "refuse", members: MEMBERS }), { value: "dev-fe", withheld: false });
  assert.deepEqual(assigneeFor("Someone", { mode: "warn", members: [] }), { value: "Someone", withheld: false });
});

test("mirrorStories alone: an unreachable tracker is reported and the others still write", async () => {
  const gh = await mockGitHub();
  const clone = checkout(brainRemote({}));
  const config = parseIntegrations({ integrations: [
    { kind: "github", api: gh.url, repo: "acme/web-a", stories: true },
    { kind: "jira", site: "http://127.0.0.1:9", project: "ABC", stories: true },
  ] });
  const policy = policyFor("work");
  const res = await mirrorStories(clone, { config, members: MEMBERS, policy, env: creds(), io: { env: creds(), policy, timeoutMs: 2000 } });
  assert.match(res.errors.jira, /unreachable|timed out/);
  assert.equal(res.written, 3);
});

test("no description at any layer: the adapter returns none, a story file renders none, and lab mirrors nothing", async () => {
  const gh = await mockGitHub();
  const policy = policyFor("work");
  const entry = parseIntegrations({ integrations: [{ kind: "github", api: gh.url, repo: "acme/web-a", stories: true }] }).integrations[0];
  const raw = await adapterFor(entry, { env: creds(), policy, timeoutMs: 2000 }).stories({ repos: ["acme/web-a"], closedSince: TODAY, days: 90 });
  assert.ok(raw.length > 0);
  assert.ok(!JSON.stringify(raw).includes(DESCRIPTION));
  // renderStory writes FIELDS only, whatever else the object carries.
  const rendered = renderStory({ ...normaliseStory({ key: "ABC-5", title: "t" }, "jira"), description: DESCRIPTION });
  assert.ok(!rendered.includes(DESCRIPTION));
  // mirrorStories called directly still refuses a profile that does not sync outward.
  let called = 0;
  const lab = policyFor("lab");
  const config = parseIntegrations({ integrations: [{ kind: "github", api: gh.url, repo: "acme/web-a", stories: true }] });
  const res = await mirrorStories(checkout(brainRemote({})), { config, policy: lab, env: creds(), io: { env: creds(), policy: lab, fetch: () => { called++; } } });
  assert.deepEqual([res.ran, res.reason, called], [false, "outward_sync_disabled", 0]);
});

// ---------------------------------------------------------------------------------------------
// R3: published story links
// ---------------------------------------------------------------------------------------------

const SHA = "0123456789ab";
function linksDoc(extra = {}) {
  return {
    format: 1, project: "web-a", repo: "acme/web-a", commit: "0123456789abcdef0123456789abcdef01234567", asOf: "2026-10-20",
    window: { maxCommits: 2000, since: null, commitsRead: 10, branchesRead: 1 },
    stories: [
      { key: "ABC-2", confidence: "extracted", commits: [{ sha: SHA, confidence: "extracted" }],
        files: [
          { path: "src/pay.js", confidence: "extracted", cluster: "c1", hub: true, tested: false },
          { path: "src/card.js", confidence: "extracted", cluster: "c1", hub: false, tested: true },
          { path: "test/pay.test.js", confidence: "extracted", cluster: "c1", hub: false, tested: null, test: true },
        ] },
      { key: "ABC-3", confidence: "inferred", commits: [{ sha: "abcdefabcdef", confidence: "inferred" }],
        files: [{ path: "src/mail/receipt.js", confidence: "inferred", cluster: "c2", hub: false, tested: false }] },
      { key: "ABC-77", confidence: "extracted", commits: [{ sha: "bbbbbbbbbbbb", confidence: "extracted" }],
        files: [{ path: "src/card.js", confidence: "extracted", cluster: "c1", hub: false, tested: true }] },
    ],
    clusters: [{ id: "c1", hub: "src/pay.js", size: 4 }, { id: "c2", hub: "src/mail/receipt.js", size: 2 }],
    unread: [],
    ...extra,
  };
}

test("publishing story links re-serialises them, commits once, and an unchanged republish commits nothing", () => {
  const remote = brainRemote({});
  const clone = checkout(remote);
  const input = JSON.stringify({ ...linksDoc(), message: "commit text that must not be published" });
  const first = publishStoryLinks(clone, { slug: "web-a", input, policy: policyFor("work"), env: {} });
  assert.equal(first.action, "created");
  assert.equal(first.pushed, true);
  const published = JSON.parse(remoteFile(remote, "projects/web-a/stories.json"));
  assert.equal(published.project, "web-a");
  assert.ok(!("message" in published));
  const head = git(remote, "rev-parse", "master").trim();
  const second = publishStoryLinks(clone, { slug: "web-a", input, policy: policyFor("work"), env: {} });
  assert.equal(second.action, "unchanged");
  assert.equal(git(remote, "rev-parse", "master").trim(), head);
});

test("on home, story links naming a denylisted ticket key are refused whole, and nothing is written", () => {
  const remote = brainRemote({});
  const clone = checkout(remote);
  const list = join(tempDir("sto-deny-"), "employer-denylist");
  writeFileSync(list, "ticket: ABC-\\d+\n");
  assert.throws(
    () => publishStoryLinks(clone, { slug: "web-a", input: JSON.stringify(linksDoc()), policy: policyFor("home"), env: { CORTEX_DENYLIST: list } }),
    (e) => e instanceof RefusedWriteError && e.code === "employer_denylist" && !e.message.includes("ABC-2"),
  );
  assert.ok(!existsSync(join(clone, "projects", "web-a", "stories.json")));
  assert.ok(!remoteHas(remote, "projects/web-a/stories.json"));
});

test("story links that are not links are refused: a bad key, a path out of the repo, an unknown confidence", () => {
  const bad = (mut) => { const d = linksDoc(); mut(d); return () => parseStoryLinks(JSON.stringify(d)); };
  assert.throws(bad((d) => { d.stories[0].key = "not a key"; }), StoryLinksRefused);
  assert.throws(bad((d) => { d.stories[0].files[0].path = "../outside.js"; }), /not a path inside the repo/);
  assert.throws(bad((d) => { d.stories[0].files[0].path = "C:/Users/x/a.js"; }), /not a path inside the repo/);
  assert.throws(bad((d) => { d.stories[0].confidence = "certain"; }), /extracted or inferred/);
  assert.throws(bad((d) => { d.format = 2; }), /format/);
});

test("the input is gated too: a credential in a field the parser drops still refuses the file", () => {
  const clone = checkout(brainRemote({}));
  const token = "gh" + "p_" + "A".repeat(36);
  const input = JSON.stringify({ ...linksDoc(), note: token });
  assert.throws(
    () => publishStoryLinks(clone, { slug: "web-a", input, policy: policyFor("work"), env: {} }),
    (e) => e instanceof RefusedWriteError && !e.message.includes(token),
  );
  assert.ok(!existsSync(join(clone, "projects", "web-a", "stories.json")));
});
