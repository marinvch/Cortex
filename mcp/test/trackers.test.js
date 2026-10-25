// Tracker integrations (#624) — the issue's acceptance list, on real git repositories and local
// mock trackers (tracker-mocks.js). A bare remote on disk is the team-brain; GitHub, ServiceNow and
// Jira are `node:http` servers on 127.0.0.1. Nothing here reaches the network.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stamp } from "../../core/date.js";
import { openBrain } from "../lib/brain.js";
import { askFrom, answerFrom, inboxFrom, parseAsk } from "../lib/asks.js";
import { syncFrom, integrationsFrom, syncPlan } from "../lib/sync.js";
import {
  checkIntegration, parseIntegrations, integrationsFromFlags, addIntegration, removeIntegration, IntegrationError,
} from "../lib/integrations.js";
import { renderSyncWorkflow } from "../lib/sync-workflow.js";
import { githubAdapter, githubRepoOf } from "../lib/trackers/github.js";
import { servicenowAdapter } from "../lib/trackers/servicenow.js";
import { jiraAdapter, toAdf, fromAdf } from "../lib/trackers/jira.js";
import { VERSION } from "../lib/version.js";
import { mockGitHub, mockServiceNow, mockJira } from "./tracker-mocks.js";
import { tempDir } from "./tmp.js";
import { policyFor } from "../../core/profile.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "ai-os.js");
const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
// Credential-shaped on purpose: the history grep below must be looking for something scrub knows.
const GH_TOKEN = ["ghp_", "T3stTok3nNotReal0000aaaa"].join("");
const SN_TOKEN = "sn-oauth-bearer-not-real-1234567890";
const FAKE_AWS_KEY = ["AKIA", "Q7X2M4N8P1R5T9V3"].join("");
const TODAY = stamp();

const mocks = [];
after(async () => { for (const m of mocks) await m.close(); });
async function track(p) { const m = await p; mocks.push(m); return m; }

function git(cwd, ...a) {
  return execFileSync("git", a, { cwd, env: { ...process.env, ...IDENTITY }, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

const MEMBERS = [
  { handle: "dev-fe", roles: ["frontend"], projects: ["web-a"] },
  { handle: "dev-be", roles: ["backend"], projects: ["svc-b"] },
];

/** A team-brain on a bare remote: roster, two project files, and `extra` merged into team.json. */
function brainRemote(extra = {}) {
  const remote = tempDir("trk-remote-");
  git(remote, "init", "--bare", "-q", "-b", "master");
  const seed = tempDir("trk-seed-");
  git(seed, "clone", "-q", remote, ".");
  mkdirSync(join(seed, "projects"), { recursive: true });
  writeFileSync(join(seed, "projects", "svc-b.md"), "---\ntype: project\ntitle: Service B\nrepo: https://github.com/acme/svc-b\ncreated: 2026-10-01\n---\n");
  writeFileSync(join(seed, "projects", "web-a.md"), "---\ntype: project\ntitle: Web A\nrepo: https://github.com/acme/web-a\ncreated: 2026-10-01\n---\n");
  writeFileSync(join(seed, "team.json"), JSON.stringify({ members: MEMBERS, ...extra }, null, 2) + "\n");
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "seed");
  git(seed, "branch", "-M", "master");
  git(seed, "push", "-q", "-u", "origin", "master");
  return remote;
}

function productRepo(project, remote) {
  const repo = tempDir(`trk-${project}-`);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "x");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  mkdirSync(join(repo, ".cortex"), { recursive: true });
  writeFileSync(join(repo, ".cortex", "connector.json"), JSON.stringify({ team: "harbor", project, teamBrainRepo: remote }, null, 2) + "\n");
  return repo;
}

const brainIn = (repo, profile) => openBrain({ cwd: repo, env: { CORTEX_ROOT: join(repo, ".cortex"), ...(profile ? { CORTEX_PROFILE: profile } : {}) } });
const creds = (extra = {}) => ({ CORTEX_AUTHOR: "dev-fe", GITHUB_TOKEN: GH_TOKEN, SERVICENOW_TOKEN: SN_TOKEN, ...extra });
let seq = 0;
const ctx = (repo, env = creds(), more = {}) => ({ env, cwd: repo, id: `t${Date.now().toString(36)}-${++seq}`, today: TODAY, ...more });

/** A fresh checkout of the remote, the way the scheduled workflow has one: no developer, no clone. */
function ciCheckout(remote) {
  const dir = tempDir("trk-ci-");
  git(dir, "clone", "-q", remote, ".");
  return dir;
}
function ciBrain() {
  const root = tempDir("trk-ciroot-");
  return openBrain({ cwd: root, env: { CORTEX_ROOT: root, CORTEX_PROFILE: "work" } });
}
const remoteHead = (remote) => git(remote, "rev-parse", "master").trim();
const remoteAsk = (remote, id) => parseAsk(git(remote, "show", `master:asks/${id}.md`));
const linkOf = (ask, kind) => ask.meta.links.find((l) => typeof l === "object" && l.kind === kind);

// ---------------------------------------------------------------------------------------------
// Selection at init
// ---------------------------------------------------------------------------------------------

test("team init with GitHub and ServiceNow writes both to team.json with ServiceNow primary, and prints the workflow before writing it", () => {
  const vault = tempDir("trk-vault-");
  const remote = tempDir("trk-init-remote-");
  git(remote, "init", "--bare", "-q", "-b", "master");
  const env = { ...process.env, ...IDENTITY, CORTEX_ROOT: vault, AI_OS_ROOT: "" };
  delete env.CORTEX_PROFILE;
  const r = spawnSync(process.execPath, [CLI, "team", "init", "--name", "harbor", "--repo", remote,
    "--integrations", "github,servicenow", "--servicenow-instance", "https://acme.service-now.com",
    "--servicenow-groups", "backend=Backend Team", "--route", "gateway=github"], { cwd: vault, env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /\[x\] GitHub issues/);
  assert.match(r.stdout, /\[x\] ServiceNow Agile/);
  assert.match(r.stdout, /\[ \] Jira/);
  assert.match(r.stdout, /Primary for status: servicenow/);
  assert.match(r.stdout, /SERVICENOW_TOKEN, or SERVICENOW_USER and SERVICENOW_PASSWORD/);
  // Printed, not written (ADR 0009).
  assert.match(r.stdout, /name: cortex-sync/);
  const tree = git(remote, "ls-tree", "-r", "--name-only", "master");
  assert.ok(!tree.includes(".github/workflows/cortex-sync.yml"), "the workflow is not written without --write-sync-workflow");

  const doc = JSON.parse(git(remote, "show", "master:team.json"));
  assert.deepEqual(doc.integrations.map((i) => i.kind), ["github", "servicenow"]);
  assert.equal(doc.primary, "servicenow");
  assert.deepEqual(doc.routes, { gateway: "github" });
  assert.deepEqual(doc.integrations[1].groups, { backend: "Backend Team" });

  // --write-sync-workflow writes it, in the same seed commit.
  const remote2 = tempDir("trk-init-remote2-");
  git(remote2, "init", "--bare", "-q", "-b", "master");
  const r2 = spawnSync(process.execPath, [CLI, "team", "init", "--name", "harbor2", "--repo", remote2,
    "--integrations", "jira", "--jira-site", "https://acme.atlassian.net", "--jira-project", "ACME", "--write-sync-workflow"], { cwd: vault, env, encoding: "utf8" });
  assert.equal(r2.status, 0, r2.stderr + r2.stdout);
  const wf = git(remote2, "show", "master:.github/workflows/cortex-sync.yml");
  assert.match(wf, /JIRA_API_TOKEN: \$\{\{ secrets\.JIRA_API_TOKEN \}\}/);
  assert.ok(!/SERVICENOW_\w+: \$\{\{/.test(wf), "only the selected trackers' secrets");
  assert.equal(JSON.parse(git(remote2, "show", "master:team.json")).primary, "jira");
});

test("the default primary is the agile tracker when one is selected, else GitHub", () => {
  const sn = { kind: "servicenow", instance: "https://acme.service-now.com" };
  const jira = { kind: "jira", site: "https://acme.atlassian.net", project: "ACME" };
  assert.equal(parseIntegrations({ integrations: [{ kind: "github" }, sn] }).primary, "servicenow");
  assert.equal(parseIntegrations({ integrations: [{ kind: "github" }, jira] }).primary, "jira");
  assert.equal(parseIntegrations({ integrations: [{ kind: "github" }] }).primary, "github");
  assert.equal(parseIntegrations({}).primary, null);
  assert.equal(parseIntegrations({ integrations: [{ kind: "github" }, sn], primary: "github" }).primary, "github");
  assert.throws(() => parseIntegrations({ integrations: [{ kind: "github" }], primary: "jira" }), IntegrationError);
});

test("a credential is refused in team.json — by its shape, by its key's name, and inside a URL", () => {
  const cases = [
    { kind: "github", token: "anything" },
    { kind: "servicenow", instance: "https://acme.service-now.com", password: "x" },
    { kind: "jira", site: "https://acme.atlassian.net", project: "ACME", apiToken: "x" },
    { kind: "servicenow", instance: "https://acme.service-now.com", fields: { authHeader: "x" } },
    { kind: "github", repo: "acme/svc-b", api: `https://x:${GH_TOKEN}@api.github.com` },
    { kind: "servicenow", instance: "https://acme.service-now.com", group: GH_TOKEN },
    { kind: "github", api: "http://acme.example.com" }, // not https, not loopback
  ];
  for (const c of cases) {
    assert.throws(() => checkIntegration(c), (e) => e instanceof IntegrationError && !e.message.includes(GH_TOKEN), JSON.stringify(Object.keys(c)));
  }
  assert.throws(() => integrationsFromFlags({ integrations: "servicenow", "servicenow-instance": "https://admin:secret@acme.service-now.com" }), IntegrationError);
  assert.throws(() => integrationsFromFlags({ integrations: "linear" }), /github, servicenow, jira or none/);
  assert.deepEqual(integrationsFromFlags({ integrations: "none" }).integrations, []);
});

test("integrations add and remove keep the rest of team.json, and a removed primary falls back to the default", () => {
  const doc = { source: "acme/cortex", members: MEMBERS };
  const one = addIntegration(doc, { kind: "github", repo: "acme/backlog" });
  const two = addIntegration(one, { kind: "servicenow", instance: "https://acme.service-now.com" }, { primary: "servicenow" });
  assert.equal(two.source, "acme/cortex");
  assert.deepEqual(two.members, MEMBERS);
  assert.equal(two.primary, "servicenow");
  const back = removeIntegration({ ...two, routes: { backend: ["servicenow", "github"] } }, "servicenow");
  assert.deepEqual(back.integrations.map((i) => i.kind), ["github"]);
  assert.equal(back.primary, undefined);
  assert.equal(parseIntegrations(back).primary, "github");
  assert.deepEqual(back.routes, { backend: "github" });
  assert.throws(() => removeIntegration(back, "jira"), /not a selected integration/);
});

// ---------------------------------------------------------------------------------------------
// The acceptance: create both, close in ServiceNow, one scheduled sync, idempotent
// ---------------------------------------------------------------------------------------------

test("ask --to backend files one GitHub issue and one ServiceNow story; closing the story answers the ask and closes the issue", async () => {
  const gh = await track(mockGitHub());
  const sn = await track(mockServiceNow());
  const remote = brainRemote({
    integrations: [{ kind: "github", api: gh.url }, { kind: "servicenow", instance: sn.url, groups: { backend: "Backend Team" } }],
    primary: "servicenow",
  });
  const repoA = productRepo("web-a", remote);
  const brain = brainIn(repoA);

  const sent = await askFrom(brain, { to: "backend", content: "Is there an endpoint for order history?" }, ctx(repoA));
  assert.equal(sent.pushed, true, JSON.stringify(sent));
  assert.equal(sent.sync.ran, true, JSON.stringify(sent.sync));
  assert.equal(sent.sync.pushed, true);
  assert.match(sent.sync.message, /^sync: (github 1 created, servicenow 1 created|servicenow 1 created, github 1 created)$/);

  // One item each, in the right place, in the documented shapes.
  assert.equal(gh.issues.length, 1);
  assert.equal(gh.issues[0].repo, "acme/svc-b", "the issue goes to the repo of the role's project");
  assert.ok(gh.issues[0].title.includes(`[ask:${sent.id}]`));
  const ghCreate = gh.requests.find((r) => r.method === "POST" && r.path === "/repos/acme/svc-b/issues");
  assert.equal(ghCreate.headers.authorization, `Bearer ${GH_TOKEN}`);
  assert.equal(ghCreate.headers["x-github-api-version"], "2022-11-28");
  assert.equal(ghCreate.headers.accept, "application/vnd.github+json");
  assert.equal(sn.records.length, 1);
  const snCreate = sn.requests.find((r) => r.method === "POST" && r.path === "/api/now/table/rm_story");
  assert.equal(snCreate.headers.authorization, `Bearer ${SN_TOKEN}`);
  assert.equal(snCreate.body.correlation_id, `cortex-ask-${sent.id}`);
  assert.equal(snCreate.body.assignment_group, "Backend Team");
  assert.match(snCreate.body.short_description, new RegExp(`^\\[ask:${sent.id}\\] `));

  const filed = remoteAsk(remote, sent.id);
  assert.equal(linkOf(filed, "github").state, "ok");
  assert.equal(linkOf(filed, "github").key, "acme/svc-b#1");
  assert.equal(linkOf(filed, "servicenow").state, "ok");
  assert.equal(linkOf(filed, "servicenow").key, sn.records[0].sys_id);
  assert.match(git(remote, "log", "-1", "--format=%s", "master"), /^sync: /);

  // Sync twice: the second changes nothing and commits nothing.
  const ci = ciCheckout(remote);
  const head = remoteHead(remote);
  const writesBefore = gh.writes().length + sn.writes().length;
  const again = await syncFrom(ciBrain(), { clone: ci }, { env: creds(), today: TODAY });
  assert.equal(again.ran, true);
  assert.equal(again.committed, false);
  assert.deepEqual(again.changed, []);
  assert.equal(remoteHead(remote), head, "no commit");
  assert.equal(gh.writes().length + sn.writes().length, writesBefore, "nothing posted");

  // Someone closes the story in ServiceNow. One scheduled sync, no developer online.
  sn.closeAsHuman(sn.records[0].sys_id, "Jane Doe");
  const ci2 = ciCheckout(remote);
  const run = await syncFrom(ciBrain(), { clone: ci2 }, { env: creds({ CORTEX_AUTHOR: undefined }), today: TODAY });
  assert.equal(run.committed, true, JSON.stringify(run));
  assert.equal(run.pushed, true, JSON.stringify(run));
  assert.match(run.message, /servicenow 1 updated/);
  const after = remoteAsk(remote, sent.id);
  assert.equal(after.meta.status, "answered");
  assert.equal(after.meta.assignee, "Jane Doe");
  assert.equal(after.answers.length, 1);
  assert.equal(after.answers[0].handle, "servicenow");
  assert.match(after.answers[0].text, /Closed in servicenow/);
  // The GitHub issue got a comment and was closed.
  const issue = gh.issues[0];
  assert.equal(issue.state, "closed");
  assert.equal(issue.state_reason, "completed");
  assert.equal(issue.comments.length, 1);
  assert.match(issue.comments[0].body, /Closed in servicenow/);
  assert.match(issue.comments[0].body, new RegExp(`\\[cortex:${sent.id}/answer-1\\]`));
  // ServiceNow was not told about its own closure.
  assert.equal(sn.journal.length, 0);

  // And again: nothing.
  const head2 = remoteHead(remote);
  const idle = await syncFrom(ciBrain(), { clone: ciCheckout(remote) }, { env: creds(), today: TODAY });
  assert.equal(idle.committed, false);
  assert.equal(remoteHead(remote), head2);

  // The asker's inbox shows it.
  const inbox = await inboxFrom(brain, ctx(repoA));
  const mine = inbox.sent.find((a) => a.id === sent.id);
  assert.equal(mine.status, "answered");
  assert.equal(mine.assignee, "Jane Doe");
});

test("on a home profile, a tracker comment naming a denylisted employer is withheld like a credential", async () => {
  const sn = await track(mockServiceNow());
  const remote = brainRemote({ integrations: [{ kind: "servicenow", instance: sn.url }] });
  const repoA = productRepo("web-a", remote);
  const sent = await askFrom(brainIn(repoA), { to: "backend", content: "Which version of the orders API?" }, ctx(repoA));
  sn.humanNote(sn.records[0].sys_id, "jane.doe", "Initech's gateway team owns that one");

  const list = join(tempDir("trk-deny-"), "employer-denylist");
  writeFileSync(list, "org: Initech\n");
  const root = tempDir("trk-homeroot-");
  const home = openBrain({ cwd: root, env: { CORTEX_ROOT: root, CORTEX_PROFILE: "home" } });
  const run = await syncFrom(home, { clone: ciCheckout(remote) }, { env: creds({ CORTEX_DENYLIST: list }), today: TODAY });
  assert.equal(run.committed, true, JSON.stringify(run));
  const note = remoteAsk(remote, sent.id).comments.find((c) => c.kind === "servicenow");
  assert.match(note.text, /^\(withheld: this servicenow comment was refused by the publish gate \(employer_denylist\)/);
  assert.ok(!git(remote, "log", "-p", "--all").includes("Initech"), "the employer's name never reached the brain");
});

test("an answer in the brain is posted to every tracker and closes them; a comment comes back once", async () => {
  const gh = await track(mockGitHub());
  const sn = await track(mockServiceNow());
  const remote = brainRemote({ integrations: [{ kind: "github", api: gh.url }, { kind: "servicenow", instance: sn.url }] });
  const repoA = productRepo("web-a", remote);
  const repoB = productRepo("svc-b", remote);
  const sent = await askFrom(brainIn(repoA), { to: "backend", content: "Which version of the orders API?" }, ctx(repoA));
  const sys = sn.records[0].sys_id;

  // A teammate comments in GitHub; another pastes a credential into a ServiceNow work note.
  gh.humanComment("acme/svc-b", 1, "octo-dev", "v2, see the changelog");
  sn.humanNote(sys, "jane.doe", `use this key: ${FAKE_AWS_KEY}`);
  const run = await syncFrom(ciBrain(), { clone: ciCheckout(remote) }, { env: creds(), today: TODAY });
  assert.equal(run.committed, true, JSON.stringify(run));
  const ask = remoteAsk(remote, sent.id);
  assert.equal(ask.comments.length, 2);
  const fromGh = ask.comments.find((c) => c.kind === "github");
  assert.equal(fromGh.author, "octo-dev");
  assert.equal(fromGh.text, "v2, see the changelog");
  const fromSn = ask.comments.find((c) => c.kind === "servicenow");
  assert.match(fromSn.text, /^\(withheld: this servicenow comment carries a AWS access key id/);
  // The secret gate on the way in: not in the file, not in the history.
  assert.ok(!git(remote, "log", "-p", "--all").includes(FAKE_AWS_KEY), "the credential never reached the brain");
  // The GitHub comment went on to ServiceNow, the withheld one went nowhere.
  assert.equal(sn.journal.filter((j) => j.sys_created_by === "cortex.integration").length, 1);
  assert.match(sn.journal.at(-1).value, /octo-dev on github:/);
  assert.ok(!gh.issues[0].comments.some((c) => c.body.includes("withheld")));

  // The member holding backend answers from their repo.
  const ans = await answerFrom(brainIn(repoB), { id: sent.id, content: "v2. The PR is acme/svc-b#40.", status: "answered" }, ctx(repoB, creds({ CORTEX_AUTHOR: "dev-be" })));
  assert.equal(ans.sync.ran, true, JSON.stringify(ans.sync));
  assert.equal(gh.issues[0].state, "closed");
  assert.equal(sn.records[0].state, "3");
  assert.ok(gh.issues[0].comments.some((c) => /Answer from dev-be \(answered\):/.test(c.body)));
  assert.ok(sn.journal.some((j) => /Answer from dev-be/.test(j.value)));

  // A second sync pulls nothing back: Cortex recognises its own comments by their tag.
  const head = remoteHead(remote);
  const idle = await syncFrom(ciBrain(), { clone: ciCheckout(remote) }, { env: creds(), today: TODAY });
  assert.equal(idle.committed, false, JSON.stringify(idle));
  assert.equal(remoteHead(remote), head);
  assert.equal(remoteAsk(remote, sent.id).comments.length, 2);
});

test("a create that timed out is found on the retry, not made twice", async () => {
  const gh = await track(mockGitHub({ createDelayMs: 600 }));
  const remote = brainRemote({ integrations: [{ kind: "github", api: gh.url }] });
  const repoA = productRepo("web-a", remote);
  const sent = await askFrom(brainIn(repoA), { to: "backend", content: "Timeout?" }, ctx(repoA, creds(), { timeoutMs: 150 }));
  assert.equal(gh.issues.length, 1, "the tracker made it");
  const pending = linkOf(remoteAsk(remote, sent.id), "github");
  assert.equal(pending.state, "pending");
  assert.match(pending.error, /timed out after 150 ms/);
  assert.match(sent.sync.message, /github 1 pending/);

  gh.state.createDelayMs = 0;
  await new Promise((r) => setTimeout(r, 700)); // let the slow response finish
  const status = await syncFrom(ciBrain(), { clone: ciCheckout(remote), status: true }, {});
  assert.deepEqual(status.stuck.map((s) => [s.id, s.kind, s.state]), [[sent.id, "github", "pending"]]);
  const plan = await syncFrom(ciBrain(), { clone: ciCheckout(remote), dryRun: true }, {});
  assert.match(plan.plan[0].steps[0], /retry the pending link/);

  const run = await syncFrom(ciBrain(), { clone: ciCheckout(remote) }, { env: creds(), today: TODAY });
  assert.equal(run.committed, true, JSON.stringify(run));
  assert.equal(gh.issues.length, 1, "no duplicate");
  const ok = linkOf(remoteAsk(remote, sent.id), "github");
  assert.equal(ok.state, "ok");
  assert.equal(ok.key, "acme/svc-b#1");
  assert.equal(ok.error, undefined);
});

test("a missing credential names the variable and leaves the link pending; the ask is still written", async () => {
  const gh = await track(mockGitHub());
  const sn = await track(mockServiceNow());
  const remote = brainRemote({ integrations: [{ kind: "github", api: gh.url }, { kind: "servicenow", instance: sn.url }] });
  const repoA = productRepo("web-a", remote);
  const sent = await askFrom(brainIn(repoA), { to: "backend", content: "No ServiceNow token here" }, ctx(repoA, creds({ SERVICENOW_TOKEN: undefined })));
  assert.equal(sent.pushed, true);
  const ask = remoteAsk(remote, sent.id);
  assert.equal(linkOf(ask, "github").state, "ok");
  const l = linkOf(ask, "servicenow");
  assert.equal(l.state, "pending");
  assert.match(l.error, /set SERVICENOW_TOKEN, or SERVICENOW_USER and SERVICENOW_PASSWORD in the environment/);
  assert.equal(sn.requests.length, 0);
  // Basic auth works too, once it is set.
  await syncFrom(ciBrain(), { clone: ciCheckout(remote) }, { env: creds({ SERVICENOW_TOKEN: undefined, SERVICENOW_USER: "integration", SERVICENOW_PASSWORD: "pw-not-real" }), today: TODAY });
  assert.equal(linkOf(remoteAsk(remote, sent.id), "servicenow").state, "ok");
  assert.match(sn.requests[0].headers.authorization, /^Basic /);
});

test("integrations remove servicenow stops syncing it; its links stay readable", async () => {
  const gh = await track(mockGitHub());
  const sn = await track(mockServiceNow());
  const remote = brainRemote({ integrations: [{ kind: "github", api: gh.url }, { kind: "servicenow", instance: sn.url }], primary: "servicenow" });
  const repoA = productRepo("web-a", remote);
  const sent = await askFrom(brainIn(repoA), { to: "backend", content: "Before removal" }, ctx(repoA));
  const key = sn.records[0].sys_id;

  const ci = ciCheckout(remote);
  const res = integrationsFrom(ciBrain(), "remove", { clone: ci, kind: "servicenow" });
  assert.equal(res.pushed, true, JSON.stringify(res));
  assert.deepEqual(res.kinds, ["github"]);
  assert.equal(res.primary, "github");
  const doc = JSON.parse(git(remote, "show", "master:team.json"));
  assert.deepEqual(doc.integrations.map((i) => i.kind), ["github"]);
  assert.deepEqual(doc.members, MEMBERS, "the roster is kept");

  sn.closeAsHuman(key);
  const before = sn.requests.length;
  await syncFrom(ciBrain(), { clone: ciCheckout(remote) }, { env: creds(), today: TODAY });
  assert.equal(sn.requests.length, before, "no call to the removed tracker");
  const ask = remoteAsk(remote, sent.id);
  assert.equal(ask.meta.status, "open", "its status no longer moves the ask");
  assert.equal(linkOf(ask, "servicenow").key, key, "the link is still there");
  const status = await syncFrom(ciBrain(), { clone: ciCheckout(remote), status: true }, {});
  assert.deepEqual(status.inactive.map((s) => [s.id, s.kind, s.key]), [[sent.id, "servicenow", key]]);
  assert.deepEqual(status.stuck, []);
});

test("no credential reaches the team-brain: not team.json, not an ask file, not the history", async () => {
  const gh = await track(mockGitHub());
  const sn = await track(mockServiceNow());
  const remote = brainRemote({ integrations: [{ kind: "github", api: gh.url }, { kind: "servicenow", instance: sn.url }] });
  const repoA = productRepo("web-a", remote);
  const sent = await askFrom(brainIn(repoA), { to: "backend", content: "Credentials?" }, ctx(repoA));
  sn.closeAsHuman(sn.records[0].sys_id);
  await syncFrom(ciBrain(), { clone: ciCheckout(remote) }, { env: creds(), today: TODAY });
  const history = git(remote, "log", "-p", "--all");
  assert.ok(history.includes(sent.id), "the history is the one with the asks in it");
  for (const secret of [GH_TOKEN, SN_TOKEN, Buffer.from(`x:${SN_TOKEN}`).toString("base64")]) {
    assert.ok(!history.includes(secret), "a credential is in the brain's history");
  }
  // And integrations refuses one on the way in, before anything is written.
  assert.throws(() => integrationsFrom(ciBrain(), "add", { clone: ciCheckout(remote), entry: { kind: "jira", site: "https://acme.atlassian.net", project: "ACME", token: GH_TOKEN } }), IntegrationError);
});

// ---------------------------------------------------------------------------------------------
// R19: no integration, no network; lab: no tracker
// ---------------------------------------------------------------------------------------------

test("with no integration, ask, inbox and answer work with fetch replaced by a function that throws", async () => {
  const remote = brainRemote();
  const repoA = productRepo("web-a", remote);
  const repoB = productRepo("svc-b", remote);
  const real = globalThis.fetch;
  let called = 0;
  globalThis.fetch = () => { called++; throw new Error("the network was touched"); };
  try {
    const sent = await askFrom(brainIn(repoA), { to: "backend", content: "Offline team?" }, ctx(repoA));
    assert.equal(sent.pushed, true);
    assert.equal(sent.sync, undefined, "a team with no tracker gets the result #620 shipped");
    const inbox = await inboxFrom(brainIn(repoB), ctx(repoB, creds({ CORTEX_AUTHOR: "dev-be" })));
    assert.equal(inbox.waiting.length, 1);
    assert.equal(inbox.sync, undefined);
    const ans = await answerFrom(brainIn(repoB), { id: sent.id, content: "Yes." }, ctx(repoB, creds({ CORTEX_AUTHOR: "dev-be" })));
    assert.equal(ans.status, "answered");
    const run = await syncFrom(ciBrain(), { clone: ciCheckout(remote) }, { env: creds(), today: TODAY });
    assert.equal(run.reason, "no_integrations");
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(called, 0);
});

test("on the lab profile no tracker is called, by an ask or by sync", async () => {
  const gh = await track(mockGitHub());
  const remote = brainRemote({ integrations: [{ kind: "github", api: gh.url }] });
  const repoA = productRepo("web-a", remote);
  const sent = await askFrom(brainIn(repoA, "lab"), { to: "backend", content: "Lab?" }, ctx(repoA));
  assert.equal(sent.pushed, false);
  assert.equal(sent.sync.reason, "outward_sync_disabled");
  const labRoot = tempDir("trk-lab-");
  const lab = openBrain({ cwd: labRoot, env: { CORTEX_ROOT: labRoot, CORTEX_PROFILE: "lab" } });
  const run = await syncFrom(lab, { clone: ciCheckout(remote) }, { env: creds(), today: TODAY });
  assert.equal(run.reason, "outward_sync_disabled");
  assert.equal(gh.requests.length, 0);
});

// ---------------------------------------------------------------------------------------------
// The adapters, one at a time, against their mocks
// ---------------------------------------------------------------------------------------------

const ASK = { id: "a1", title: "Order history", question: "Is there an endpoint?", to: "backend", toKind: "role", from: "dev-fe", fromProject: "web-a", created: TODAY };

test("the Jira adapter: create with a label and an ADF description, find by label, comment, read, close by transition", async () => {
  const jira = await track(mockJira());
  const api = jiraAdapter({ kind: "jira", site: jira.url, project: "ACME", issueType: "Story" }, { env: { JIRA_EMAIL: "bot@acme.example", JIRA_API_TOKEN: "jira-not-real" }, policy: policyFor("home") });
  assert.equal(await api.find(ASK), null);
  const made = await api.create(ASK);
  assert.deepEqual(made, { key: "ACME-1", url: `${jira.url}/browse/ACME-1` });
  const post = jira.requests.find((r) => r.method === "POST" && r.path === "/rest/api/3/issue");
  assert.equal(post.body.fields.issuetype.name, "Story");
  assert.deepEqual(post.body.fields.labels, ["cortex-ask-a1"]);
  assert.equal(post.body.fields.description.type, "doc");
  assert.equal(post.headers.authorization, `Basic ${Buffer.from("bot@acme.example:jira-not-real").toString("base64")}`);
  assert.deepEqual(await api.find(ASK), made);
  await api.comment("ACME-1", "first\n\nsecond");
  const r1 = await api.read("ACME-1");
  assert.equal(r1.status, "open");
  assert.equal(r1.comments[0].text, "first\n\nsecond");
  await api.close("ACME-1", "answered");
  const t = jira.requests.find((r) => r.method === "POST" && r.path.endsWith("/transitions"));
  assert.deepEqual(t.body, { transition: { id: "31" } });
  assert.equal((await api.read("ACME-1")).status, "answered");
  await assert.rejects(() => jiraAdapter({ kind: "jira", site: jira.url, project: "ACME" }, { env: {} }).find(ASK), /JIRA_EMAIL and JIRA_API_TOKEN/);
});

test("the ServiceNow adapter reads plain and display values, and a custom table, fields and states", async () => {
  const sn = await track(mockServiceNow({ table: "x_acme_story" }));
  const api = servicenowAdapter(
    { kind: "servicenow", instance: sn.url, table: "x_acme_story", states: { 3: "decided" } },
    { env: { SERVICENOW_TOKEN: SN_TOKEN }, policy: policyFor("home") },
  );
  const made = await api.create({ ...ASK, target: { group: "Platform" } });
  assert.match(made.url, new RegExp(`/x_acme_story\\.do\\?sys_id=${made.key}$`));
  sn.closeAsHuman(made.key, "Ana Lee");
  const r = await api.read(made.key);
  assert.equal(r.status, "decided");
  assert.equal(r.assignee, "Ana Lee");
  assert.equal(r.state, "Complete");
  const get = sn.requests.find((x) => x.method === "GET" && x.path.endsWith(made.key));
  assert.equal(get.query.sysparm_display_value, "all");
  assert.throws(() => servicenowAdapter({ kind: "servicenow", instance: sn.url, table: "bad;table" }, {}), /not a table or field name/);
});

test("the GitHub adapter maps state_reason, and finds the repo from a project file's link", async () => {
  const gh = await track(mockGitHub());
  const api = githubAdapter({ kind: "github", api: gh.url }, { env: { GH_TOKEN }, policy: policyFor("home") });
  const made = await api.create({ ...ASK, target: { repo: "acme/svc-b" } });
  await api.close(made.key, "wontfix");
  assert.equal(gh.issues[0].state_reason, "not_planned");
  assert.equal((await api.read(made.key)).status, "wontfix");
  assert.equal(githubRepoOf("https://github.com/acme/svc-b.git"), "acme/svc-b");
  assert.equal(githubRepoOf("git@github.com:acme/svc-b.git"), "acme/svc-b");
  assert.equal(githubRepoOf("https://gitlab.com/acme/svc-b"), null);
  await assert.rejects(() => githubAdapter({ kind: "github", api: gh.url }, { env: {} }).create({ ...ASK, target: { repo: "acme/svc-b" } }), /GITHUB_TOKEN \(or GH_TOKEN\)/);
});

test("ADF goes out as paragraphs and comes back as text", () => {
  assert.equal(fromAdf(toAdf("a\n\nb")), "a\n\nb");
  assert.equal(fromAdf({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }, { type: "hardBreak" }, { type: "text", text: "y" }] }] }), "x\ny");
});

// ---------------------------------------------------------------------------------------------
// The scheduled workflow
// ---------------------------------------------------------------------------------------------

test("the sync workflow is pinned, clones the team's Cortex at this release, and names only the selected trackers' secrets", () => {
  const wf = renderSyncWorkflow({ kinds: ["github", "servicenow"], source: "acme/cortex", profile: "work" });
  assert.ok(!/{{[A-Z_]+}}/.test(wf), "every placeholder filled");
  assert.match(wf, /CORTEX_REPO: https:\/\/github\.com\/acme\/cortex\.git/);
  assert.match(wf, new RegExp(`CORTEX_REF: v${VERSION.replace(/\./g, "\\.")}`));
  assert.match(wf, /uses: actions\/checkout@[0-9a-f]{40} # v/);
  assert.match(wf, /persist-credentials: false/);
  assert.match(wf, /sync --clone "\$GITHUB_WORKSPACE" --no-push/);
  assert.match(wf, /extraheader=AUTHORIZATION: basic/);
  // The tracker secrets and the repo token are never in one step.
  const steps = wf.split(/\n      - /);
  const syncStep = steps.find((s) => s.includes("--no-push"));
  const pushStep = steps.find((s) => s.includes("extraheader"));
  assert.ok(!syncStep.includes("github.token") && !pushStep.includes("secrets."), "one step holds the trackers' secrets, another the push token");
  assert.match(wf, /GH_TOKEN: \$\{\{ secrets\.CORTEX_GITHUB_TOKEN \}\}/);
  assert.match(wf, /SERVICENOW_TOKEN: \$\{\{ secrets\.SERVICENOW_TOKEN \}\}/);
  assert.ok(!/JIRA_\w+: \$\{\{/.test(wf));
  assert.match(wf, /sync --clone "\$GITHUB_WORKSPACE"/);
  assert.match(renderSyncWorkflow({ kinds: ["github"], profile: "lab" }), /CORTEX_PROFILE: work/, "a lab job would sync nothing forever");
  assert.match(renderSyncWorkflow({ kinds: ["github"], profile: "home" }), /marinvch\/Cortex\.git/, "upstream when the team set no source");
  assert.throws(() => renderSyncWorkflow({ kinds: [], profile: "work" }), /nothing for a scheduled sync to do/);
  assert.throws(() => renderSyncWorkflow({ kinds: ["github"], source: "/srv/cortex", profile: "work" }), /a runner cannot clone it/);
});

test("integrations workflow prints by default and commits only with --write", () => {
  const remote = brainRemote({ integrations: [{ kind: "github", repo: "acme/backlog" }] });
  const ci = ciCheckout(remote);
  const shown = integrationsFrom(ciBrain(), "workflow", { clone: ci });
  assert.equal(shown.written, false);
  assert.ok(!existsSync(join(ci, ".github")));
  const w = integrationsFrom(ciBrain(), "workflow", { clone: ci, write: true });
  assert.equal(w.pushed, true, JSON.stringify(w));
  assert.equal(git(remote, "show", "master:.github/workflows/cortex-sync.yml"), shown.text);
  const list = integrationsFrom(ciBrain(), "list", { clone: ci }, { env: { GH_TOKEN } });
  assert.equal(list.workflow, ".github/workflows/cortex-sync.yml");
  assert.deepEqual(list.integrations.map((i) => [i.kind, i.primary, i.credentials.set]), [["github", true, true]]);
  assert.ok(!JSON.stringify(list).includes(GH_TOKEN), "list says whether a credential is set, never what it is");
});

test("the dry run calls nothing and writes nothing", async () => {
  const remote = brainRemote({ integrations: [{ kind: "github", repo: "acme/backlog" }] });
  const repoA = productRepo("web-a", remote);
  const real = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network"); };
  try {
    // An ask on a team whose GitHub has no credential: it is written, the link is pending.
    const sent = await askFrom(brainIn(repoA), { to: "backend", content: "Dry?" }, ctx(repoA, { CORTEX_AUTHOR: "dev-fe" }));
    const ci = ciCheckout(remote);
    const head = remoteHead(remote);
    const plan = syncPlan(ci, { policy: policyFor("home") });
    assert.equal(plan.plan[0].id, sent.id);
    assert.equal(git(ci, "status", "--porcelain").trim(), "");
    assert.equal(remoteHead(remote), head);
  } finally {
    globalThis.fetch = real;
  }
});

test("--no-push commits the sync and leaves the push to the workflow's own step", async () => {
  const gh = await track(mockGitHub());
  const remote = brainRemote({ integrations: [{ kind: "github", api: gh.url }] });
  const repoA = productRepo("web-a", remote);
  await askFrom(brainIn(repoA), { to: "backend", content: "Push later" }, ctx(repoA, { CORTEX_AUTHOR: "dev-fe" })); // no token: pending
  const ci = ciCheckout(remote);
  const head = remoteHead(remote);
  const res = await syncFrom(ciBrain(), { clone: ci, push: false }, { env: creds(), today: TODAY });
  assert.equal(res.committed, true, JSON.stringify(res));
  assert.equal(res.pushed, false);
  assert.equal(remoteHead(remote), head, "nothing pushed");
  assert.equal(git(ci, "log", "-1", "--format=%s").trim(), "sync: github 1 created");
});

test("the CLI wires sync, its dry run and its status, and integrations list", () => {
  const remote = brainRemote({ integrations: [{ kind: "servicenow", instance: "https://acme.service-now.com" }] });
  const ci = ciCheckout(remote);
  const root = tempDir("trk-cli-");
  const env = { ...process.env, ...IDENTITY, CORTEX_ROOT: root, AI_OS_ROOT: "", CORTEX_PROFILE: "work", SERVICENOW_TOKEN: "" };
  const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { cwd: root, env, encoding: "utf8" });
  const list = run("integrations", "list", "--clone", ci);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /\[x\] ServiceNow Agile/);
  assert.match(list.stdout, /servicenow \(primary\): credentials NOT set — SERVICENOW_TOKEN, or SERVICENOW_USER and SERVICENOW_PASSWORD/);
  const dry = run("sync", "--clone", ci, "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run — no tracker is called/);
  const status = run("sync", "--clone", ci, "--status");
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Not in sync \(0\)/);
  const bad = run("integrations", "add", "jira", "--clone", ci, "--jira-site", "https://acme.atlassian.net");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /integrations\.jira needs 'project'/);
});
