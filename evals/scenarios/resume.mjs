// /resume — read the state off disk, report it, route. Three checkable judgments:
//   UNCOMMITTED — the branch the dirt is on, named in the same breath (or none).
//   HIDDEN      — branches other than the current one holding work that exists nowhere else: commits
//                 not on master AND not on a remote (no upstream, or ahead of it). A branch in sync with
//                 an open PR is visible, not hidden; a merged one holds nothing. A branch whose upstream
//                 is gone is only ever generated merged: a gone upstream on an unmerged branch is also
//                 what a squash merge looks like, so the state alone could not settle it.
//   ROUTE       — the one ritual the state calls for. Each scenario carries exactly one signal.

import { rng, pick, int, shuffle, branchName, sha, readAnswer, listOf, setF1, sameSet } from "../lib.mjs";

const SUBJECTS = [
  "The index counted vendored files as source", "A stale digest printed the same green tick",
  "Retry the webhook once before giving up", "The cart total rounded twice", "Move the date helper into core",
  "Search ignored the locale on the first page", "Invoices were emailed before they were saved",
];

const ROUTES = {
  "/ship": ["what's left to do here?", "continue where we left off", "ok what's next"],
  "/handoff": [
    "I've only got ten minutes before I have to go — where are we?",
    "quick one, I'm leaving soon: what's the state?",
  ],
  "/catch-me-up": [
    "I've been away for three weeks. What changed while I was gone?",
    "back from holiday — what did I miss on this repo?",
  ],
  "/dream": [
    "continue — yesterday we figured out why the importer double-counts, but I don't think any of that got written down",
    "resume. We learned a lot last session about the cache invalidation and none of it is recorded anywhere",
  ],
  "/cortex-next": [
    "I installed cortex here last week and lost track — which step was I on?",
    "where am I in the cortex setup for this repo?",
  ],
};

const UPSTREAM = {
  ahead: (b) => `[origin/${b.name}: ahead ${2 + (b.sha.charCodeAt(0) % 3)}]`,
  "no-upstream": () => "",
  "in-sync-pr": (b) => `[origin/${b.name}]`,
  "merged-local": () => "",
  "gone-merged": (b) => `[origin/${b.name}: gone]`,
};
const UNMERGED = new Set(["ahead", "no-upstream", "in-sync-pr"]);
const LOCAL_ONLY = new Set(["ahead", "no-upstream"]);

export function generate(seed) {
  const r = rng(seed);
  const route = pick(r, Object.keys(ROUTES));
  const used = new Set(["master"]);
  const current = branchName(r, used);
  // Dirt and local-only work are mid-task signals; keep them out of the routes they would contradict.
  const dirty = !["/catch-me-up", "/ship"].includes(route) && r() < 0.65;
  const kinds = route === "/catch-me-up"
    ? shuffle(r, ["merged-local", "gone-merged", "merged-local"])
    : shuffle(r, ["ahead", "no-upstream", "in-sync-pr", "merged-local", "gone-merged", "in-sync-pr", "ahead"]);
  const branches = kinds.slice(0, int(r, 2, 5)).map((kind) => ({ name: branchName(r, used), kind, sha: sha(r) }));
  // /ship needs open PRs; every other route must have none, or /ship would be a second signal.
  if (route === "/ship" && !branches.some((b) => b.kind === "in-sync-pr")) branches.push({ name: branchName(r, used), kind: "in-sync-pr", sha: sha(r) });
  if (route !== "/ship") for (const b of branches) if (b.kind === "in-sync-pr") b.kind = "merged-local";

  const memory = route === "/cortex-next" ? null : [`2026-0${int(r, 6, 8)}-${String(int(r, 10, 28)).padStart(2, "0")}`];
  const files = ["src/app.ts", "src/cart.ts", "src/index.ts", "src/sync.ts", "README.md"];
  return {
    route, message: pick(r, ROUTES[route]), current, currentSha: sha(r), dirty,
    dirtyFiles: dirty ? shuffle(r, files).slice(0, int(r, 1, 2)) : [],
    branches, memory, subjects: shuffle(r, SUBJECTS), prBase: int(r, 200, 400),
  };
}

export function render(s) {
  const vv = [
    `* ${s.current.padEnd(26)} ${s.currentSha} [origin/${s.current}] ${s.subjects[0]}`,
    ...s.branches.map((b, i) => `  ${b.name.padEnd(26)} ${b.sha} ${UPSTREAM[b.kind](b)} ${s.subjects[(i + 1) % s.subjects.length]}`.replace(/ {2,}(?=\S)/g, (m, off) => (off < 30 ? m : " "))),
  ];
  const noMerged = s.branches.filter((b) => UNMERGED.has(b.kind)).map((b) => `  ${b.name}`);
  const prs = s.branches.filter((b) => b.kind === "in-sync-pr").map((b, i) => `${s.prBase + i}\t${s.subjects[(i + 3) % s.subjects.length]}\t${b.name}\tOPEN`);
  return [
    `The user says: "${s.message}"`,
    "",
    "You cannot run commands. This is what the repo reported:",
    "",
    "$ node cortex-preflight.mjs",
    "root      /home/dev/app",
    "profile   home (default)",
    s.memory ? "index     2d old" : "index     none — run `node index/cortex-index.mjs .` first",
    "",
    "$ git status --short",
    ...(s.dirty ? s.dirtyFiles.map((f) => ` M ${f}`) : ["(clean)"]),
    "",
    "$ git log --oneline -4",
    ...s.subjects.slice(0, 4).map((m, i) => `${["9f1c2e0", "4b7d913", "e02a6c8", "71c5b3d"][i]} ${m}`),
    "",
    "$ git branch -vv",
    ...vv,
    "",
    "$ git branch --no-merged master",
    ...(noMerged.length ? noMerged : ["(nothing)"]),
    "",
    "$ ls .cortex/memory/",
    ...(s.memory ? s.memory.map((d) => `${d}.md`) : ["ls: cannot access '.cortex/memory/': No such file or directory"]),
    "",
    "$ gh pr list --state open",
    ...(prs.length ? prs : ["no open pull requests"]),
    "",
    "The current branch is in sync with its upstream except for any uncommitted changes shown above.",
    "Report the state, then end your reply with exactly these three lines:",
    "UNCOMMITTED: <branch the uncommitted changes are on>   (or: UNCOMMITTED: none)",
    "HIDDEN: <branch>, <branch>   — other branches holding work that exists only locally (or: HIDDEN: none)",
    "ROUTE: <the one ritual to route to: /ship, /handoff, /catch-me-up, /dream or /cortex-next>",
  ].join("\n");
}

export function truth(s) {
  return {
    uncommitted: s.dirty ? s.current : "none",
    hidden: s.branches.filter((b) => LOCAL_ONLY.has(b.kind)).map((b) => b.name),
    route: s.route,
  };
}

export function score(prediction, t) {
  const a = readAnswer(prediction, ["UNCOMMITTED", "HIDDEN", "ROUTE"]);
  const reasons = [];
  const unc = (a.UNCOMMITTED || "").trim();
  const uncOk = unc.toLowerCase() === t.uncommitted.toLowerCase();
  if (!uncOk) reasons.push(`UNCOMMITTED should be ${t.uncommitted}, got "${unc || "(missing)"}"`);
  const hid = listOf(a.HIDDEN);
  const hidF1 = hid === null ? 0 : setF1(hid, t.hidden);
  const hidOk = hid !== null && sameSet(hid, t.hidden);
  if (!hidOk) reasons.push(`HIDDEN should be ${t.hidden.join(", ") || "none"}, got "${a.HIDDEN ?? "(missing)"}"`);
  const route = ((a.ROUTE || "").match(/\/[a-z-]+/) || [""])[0];
  const routeOk = route === t.route;
  if (!routeOk) reasons.push(`ROUTE should be ${t.route}, got "${a.ROUTE ?? "(missing)"}"`);
  return {
    hard: uncOk && hidOk && routeOk ? 1 : 0,
    soft: ((uncOk ? 1 : 0) + hidF1 + (routeOk ? 1 : 0)) / 3,
    reason: reasons.join("; ") || "correct",
  };
}
