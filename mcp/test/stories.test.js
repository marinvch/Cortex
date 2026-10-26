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
import { graphFrom, STORY_OPS } from "../lib/graph-stories.js";
import { TOOL_TABLE, ANY } from "../lib/tools.js";
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

// ---------------------------------------------------------------------------------------------
// R4: the graph's story ops
// ---------------------------------------------------------------------------------------------

/** A team-brain holding a mirror, one project's links and contract, and an open ask. */
function storyBrain({ links = linksDoc(), stories = null } = {}) {
  const remote = brainRemote({});
  const seed = checkout(remote);
  const put = (rel, text) => { mkdirSync(dirname(join(seed, rel)), { recursive: true }); writeFileSync(join(seed, rel), text); };
  const mirror = stories ?? [
    { key: "ABC-1", kind: "epic", title: "Checkout", status: "active" },
    { key: "ABC-2", kind: "story", title: "Pay by card", status: "active", epic: "ABC-1" },
    { key: "ABC-3", kind: "story", title: "Receipt email", status: "open", epic: "ABC-1" },
    { key: "ABC-4", kind: "story", title: "Done already", status: "done", epic: "ABC-1" },
  ];
  for (const s of mirror) put(`stories/${s.key}.md`, renderStory(normaliseStory(s, "jira")));
  put("projects/web-a/stories.json", JSON.stringify(links));
  put("projects/web-a/contract.json", JSON.stringify({
    format: 1, project: "web-a", source: "routes",
    serves: [{ method: "POST", path: "/payments", files: ["src/pay.js"] }, { method: "GET", path: "/health", files: ["src/health.js"] }],
    calls: [], bases: [], events: [], unread: [],
  }));
  put("asks/20261020-q1.md", "---\ntype: ask\nid: 20261020-q1\ntitle: Card limits for ABC-2\nfrom: dev-fe\nfromProject: web-a\nto: backend\ntoKind: role\nstatus: open\ncreated: 2026-10-20\nupdated: 2026-10-20\nlinks: []\n---\n\nWhat is the limit?\n");
  put("asks/20261020-q2.md", "---\ntype: ask\nid: 20261020-q2\ntitle: About ABC-22\nfrom: dev-fe\nfromProject: web-a\nto: backend\ntoKind: role\nstatus: open\ncreated: 2026-10-20\nupdated: 2026-10-20\nlinks: []\n---\n\nUnrelated.\n");
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "stories");
  git(seed, "push", "-q");
  return remote;
}

/** A PM's brain: a vault root, no repo, the team named by CORTEX_TEAM. */
function deskBrain(remote) {
  const root = tempDir("sto-vault-");
  const elsewhere = tempDir("sto-cwd-");
  return openBrain({ cwd: elsewhere, env: { CORTEX_ROOT: root, CORTEX_PROFILE: "work", CORTEX_TEAM: "harbor", CORTEX_TEAM_REPO: remote } });
}

test("story: an epic's code across its stories, with clusters, contracts, untested files, hubs and open asks", () => {
  const brain = deskBrain(storyBrain());
  const res = graphFrom(brain, { op: "story", key: "abc-1" }, { cwd: tempDir("sto-x-") });
  assert.equal(res.pull.ok, true);
  assert.equal(res.key, "ABC-1");
  assert.equal(res.story.kind, "epic");
  assert.deepEqual(res.children.items.map((c) => c.key), ["ABC-2", "ABC-3", "ABC-4"]);
  assert.deepEqual(res.files.items.map((f) => `${f.path}:${f.confidence}`), ["src/card.js:extracted", "src/pay.js:extracted", "test/pay.test.js:extracted", "src/mail/receipt.js:inferred"]);
  assert.deepEqual(res.contracts.items.map((c) => `${c.side} ${c.method} ${c.path}`), ["serves POST /payments"]);
  assert.deepEqual(res.untested.items.map((f) => f.path), ["src/pay.js", "src/mail/receipt.js"]);
  assert.deepEqual(res.hubs.items.map((f) => f.path), ["src/pay.js"]);
  assert.deepEqual(res.asks.items.map((a) => a.id), ["20261020-q1"]);
  assert.deepEqual(res.clusters.items.map((c) => `${c.cluster}:${c.files}`), ["c1:3", "c2:1"]);
  assert.match(res.note, /A floor/);
  assert.deepEqual(res.links.projects.map((p) => p.state), ["unchecked"]);
});

test("story: a file two stories touched keeps the surer confidence of the two", () => {
  const links = linksDoc();
  // ABC-3 is read after ABC-2; its weaker link to src/pay.js must not downgrade ABC-2's.
  links.stories[1].files.push({ path: "src/pay.js", confidence: "inferred", cluster: "c1", hub: true, tested: false });
  const brain = deskBrain(storyBrain({ links }));
  const res = graphFrom(brain, { op: "story", key: "ABC-1" }, {});
  const pay = res.files.items.find((f) => f.path === "src/pay.js");
  assert.equal(pay.confidence, "extracted");
  assert.deepEqual(pay.stories, ["ABC-2", "ABC-3"]);
});

test("story: a key only commits name is answered without a mirror, and an unknown key is refused with near matches", () => {
  const brain = deskBrain(storyBrain());
  const res = graphFrom(brain, { op: "story", key: "ABC-77" }, {});
  assert.equal(res.mirrored, false);
  assert.match(res.mirrorNote, /Not mirrored/);
  assert.throws(() => graphFrom(brain, { op: "story", key: "ABC-7" }, {}), (e) => e.code === "not_found" && /ABC-77/.test(e.message));
  assert.throws(() => graphFrom(brain, { op: "story", key: "nonsense" }, {}), (e) => e.code === "bad_key");
});

test("stories-for: a file, a directory and a cluster; a path out of the repo is refused before anything is read", () => {
  const brain = deskBrain(storyBrain());
  assert.deepEqual(graphFrom(brain, { op: "stories-for", file: "src/card.js" }, {}).stories.items.map((s) => s.key), ["ABC-2", "ABC-77"]);
  assert.deepEqual(graphFrom(brain, { op: "stories-for", file: "src/mail" }, {}).stories.items.map((s) => `${s.key}:${s.confidence}`), ["ABC-3:inferred"]);
  assert.deepEqual(graphFrom(brain, { op: "stories-for", cluster: "c2", project: "web-a" }, {}).stories.items.map((s) => s.key), ["ABC-3"]);
  for (const f of ["../secret.js", "/etc/passwd", "C:\\x\\y.js", "src/../../x"]) {
    assert.throws(() => graphFrom(brain, { op: "stories-for", file: f }, {}), (e) => e.code === "outside_root", f);
  }
  assert.throws(() => graphFrom(brain, { op: "stories-for", cluster: "c2" }, {}), (e) => e.code === "missing_argument");
});

test("risk: open stories touching untested or hub code, most first; done stories and epics are not ranked", () => {
  const brain = deskBrain(storyBrain());
  const res = graphFrom(brain, { op: "risk" }, {});
  assert.deepEqual(res.stories.items.map((s) => [s.key, s.untestedCount, s.hubCount]), [["ABC-2", 1, 1], ["ABC-3", 1, 0]]);
  assert.deepEqual(res.epics.items.map((e) => [e.key, e.storiesAtRisk]), [["ABC-1", 2]]);
  assert.equal(res.unmirrored, 1);
});

test("lists are capped at 50 with the full count", () => {
  const stories = Array.from({ length: 60 }, (_, i) => ({ key: `ABC-${100 + i}`, kind: "story", title: `S${i}`, status: "open" }));
  const links = linksDoc({ stories: stories.map((s) => ({ key: s.key, confidence: "extracted", commits: [{ sha: SHA, confidence: "extracted" }], files: [{ path: "src/pay.js", confidence: "extracted", cluster: "c1", hub: true, tested: false }] })) });
  const brain = deskBrain(storyBrain({ links, stories }));
  const res = graphFrom(brain, { op: "risk" }, {});
  assert.equal(res.stories.items.length, 50);
  assert.equal(res.stories.total, 60);
  assert.equal(res.stories.truncated, true);
});

test("in a repo, its own links behind HEAD are refused with the commands that publish them again", () => {
  const remote = storyBrain();
  const repo = tempDir("sto-repo-");
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.js"), "1");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "one");
  const linked = git(repo, "rev-parse", "HEAD").trim();
  writeFileSync(join(repo, "a.js"), "2");
  git(repo, "commit", "-qam", "two");
  mkdirSync(join(repo, ".cortex"), { recursive: true });
  writeFileSync(join(repo, ".cortex", "connector.json"), JSON.stringify({ team: "harbor", project: "web-a", teamBrainRepo: remote }));
  // The published links name the first commit; the repo has moved one past it.
  const seed = checkout(remote);
  writeFileSync(join(seed, "projects", "web-a", "stories.json"), JSON.stringify(linksDoc({ commit: linked })));
  git(seed, "commit", "-qam", "links at one");
  git(seed, "push", "-q");
  const brain = openBrain({ cwd: repo, env: { CORTEX_ROOT: join(repo, ".cortex"), CORTEX_PROFILE: "work" } });
  const res = graphFrom(brain, { op: "risk" }, { cwd: repo });
  assert.equal(res.refused, true);
  assert.match(res.message, /1 commit behind/);
  assert.match(res.rebuild, /cortex-stories\.mjs/);
  assert.throws(() => graphFrom(brain, { op: "stories-for", file: "../x.js" }, { cwd: repo }), OutsideRootError);
});

test("with no published links the story ops refuse, and without a team they say how to name one", () => {
  const remote = brainRemote({});
  const res = graphFrom(deskBrain(remote), { op: "risk" }, {});
  assert.equal(res.refused, true);
  assert.match(res.message, /No repo of this team has published story links/);
  const solo = openBrain({ cwd: tempDir("sto-solo-"), env: { CORTEX_ROOT: tempDir("sto-solo-root-") } });
  assert.throws(() => graphFrom(solo, { op: "risk" }, {}), (e) => e.code === "no_team" && /join-team/.test(e.message));
  assert.throws(() => graphFrom(null, { op: "risk" }, {}), (e) => e.code === "no_team" && /CORTEX_TEAM/.test(e.message));
  // The code ops still refuse in a vault.
  assert.throws(() => graphFrom(deskBrain(remote), { op: "stats" }, { cwd: tempDir("sto-y-") }), (e) => e.code === "not_a_repo");
});

test("the graph tool runs in either mode, and its schema offers the story ops", () => {
  const row = TOOL_TABLE.find((t) => t.name === "graph");
  assert.equal(row.mode, ANY);
  for (const op of STORY_OPS) assert.ok(row.inputSchema.properties.op.enum.includes(op));
  assert.ok(row.inputSchema.properties.key && row.inputSchema.properties.project);
});

// ---------------------------------------------------------------------------------------------
// R4: naming the team without a connector
// ---------------------------------------------------------------------------------------------

test("CORTEX_TEAM names the team where no connector is found; a connector still wins", () => {
  const root = tempDir("sto-res-");
  const r = resolveBrain({ cwd: tempDir("sto-res-cwd-"), env: { CORTEX_ROOT: root, CORTEX_TEAM: "Harbor Team", CORTEX_TEAM_REPO: "https://git.example.test/team-brain.git" } });
  assert.equal(r.audience, "team");
  assert.equal(r.team, "Harbor Team");
  assert.equal(r.teamClone, join(root, "team", "harbor-team"));
  assert.equal(r.teamBrainRepo, "https://git.example.test/team-brain.git");
  assert.equal(r.source, "env:CORTEX_TEAM");

  const repo = tempDir("sto-res-repo-");
  mkdirSync(join(repo, ".cortex"), { recursive: true });
  writeFileSync(join(repo, ".cortex", "connector.json"), JSON.stringify({ team: "other", project: "p", teamBrainRepo: "x" }));
  const c = resolveBrain({ cwd: repo, env: { CORTEX_ROOT: root, CORTEX_TEAM: "harbor" } });
  assert.equal(c.team, "other");

  const none = resolveBrain({ cwd: tempDir("sto-res-cwd-"), env: { CORTEX_ROOT: root, CORTEX_TEAM: "  " } });
  assert.equal(none.audience, "solo");
});

test("the CLI: stories publish, and graph story through CORTEX_TEAM", () => {
  const remote = storyBrain();
  const root = tempDir("sto-cli-vault-");
  const env = { ...process.env, ...IDENTITY, CORTEX_ROOT: root, AI_OS_ROOT: "", CORTEX_PROFILE: "work", CORTEX_TEAM: "harbor", CORTEX_TEAM_REPO: remote, CLAUDE_CLI_BIN: "/no/such/claude" };
  const cwd = tempDir("sto-cli-cwd-");
  const show = spawnSync(process.execPath, [CLI, "graph", "story", "ABC-2", "--json"], { cwd, env, encoding: "utf8" });
  assert.equal(show.status, 0, show.stderr);
  assert.deepEqual(JSON.parse(show.stdout).untested.items.map((f) => f.path), ["src/pay.js"]);
  const text = spawnSync(process.execPath, [CLI, "graph", "risk"], { cwd, env, encoding: "utf8" });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /ABC-2 active {2}1 untested, 1 hub/);

  const file = join(tempDir("sto-cli-file-"), "stories.json");
  writeFileSync(file, JSON.stringify(linksDoc({ project: "svc-b", stories: [linksDoc().stories[1]] })));
  const pub = spawnSync(process.execPath, [CLI, "stories", "publish", "--file", file], { cwd, env, encoding: "utf8" });
  assert.equal(pub.status, 0, pub.stderr);
  assert.match(pub.stdout, /Story links for svc-b created \(1 story\)/);
  assert.ok(remoteHas(remote, "projects/svc-b/stories.json"));
});
