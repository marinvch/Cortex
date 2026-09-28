// /resume — read the state off disk, report it, route. Three checkable judgments:
//   UNCOMMITTED — the branch this checkout's dirt is on, named in the same breath (or none).
//   HIDDEN      — branches other than the current one holding work that exists nowhere else: commits
//                 not on master AND not on a remote (no upstream, or ahead of it), plus a branch whose
//                 only work is uncommitted in ANOTHER worktree. A branch in sync with an open PR is
//                 visible, not hidden; a merged one holds nothing. A branch whose upstream is gone is
//                 only ever generated merged: a gone upstream on an unmerged branch is also what a
//                 squash merge looks like, so the state alone could not settle it.
//   ROUTE       — the one ritual the state calls for, by the skill's ordered rules.
//
// The tasks are built around what the skill teaches that a generic reader gets wrong (#472). With no
// skill at all the first version of these tasks still scored 0.944 soft, so deleting the skill would
// not have tripped the alarm. The traps, each true by construction:
//   - `ahead N` on a branch `--no-merged` does NOT list: its commits are already on master, which is
//     in sync with origin. Only `--no-merged` decides; `-vv` markers never add a branch.
//   - a no-upstream branch `--no-merged` does not list: local, but nothing on it is at risk.
//   - a `+` branch checked out in another worktree, with no commits of its own but dirt in that
//     worktree: no branch test sees it, and it is the one entry that skips the `--no-merged` check.
//     A clean extra worktree is cleanup.
//   - the current branch appearing in `--no-merged`: it is removed, it is not "other".
//   - route ORDER: what the user says about themselves outranks the repo state. Leaving soon is
//     /handoff and a lesson nobody wrote down is /dream, even with open PRs sitting there; being back
//     from time away is /catch-me-up only when nothing is mid-flight — with open PRs it is /ship.
//   - "what's next" with no open PRs is /cortex-next, not /ship: stale or local-only branches are
//     not a PR queue.

import { rng, pick, int, shuffle, branchName, sha, readAnswer, listOf, setF1, sameSet } from "../lib.mjs";

const SUBJECTS = [
  "The index counted vendored files as source", "A stale digest printed the same green tick",
  "Retry the webhook once before giving up", "The cart total rounded twice", "Move the date helper into core",
  "Search ignored the locale on the first page", "Invoices were emailed before they were saved",
];

const MESSAGES = {
  next: ["what's left to do here?", "continue where we left off", "ok what's next"],
  leaving: [
    "I've only got ten minutes before I have to go — where are we?",
    "quick one, I'm leaving soon: what's the state?",
  ],
  away: [
    "I've been away for three weeks. What changed while I was gone?",
    "back from holiday — what did I miss on this repo?",
  ],
  lesson: [
    "continue — yesterday we figured out why the importer double-counts, but I don't think any of that got written down",
    "resume. We learned a lot last session about the cache invalidation and none of it is recorded anywhere",
  ],
  setup: [
    "I installed cortex here last week and lost track — which step was I on?",
    "where am I in the cortex setup for this repo?",
  ],
};

// A variant is the user's message plus what the repo must (or must not) show, and the route the
// skill's ordered rules give for that combination. `prs`: "yes" forces an open PR, "no" forbids one,
// "maybe" lets the draw decide — a PR there is the trap, because the earlier rule still wins.
const VARIANTS = [
  { name: "ship", message: "next", prs: "yes", dirty: false, route: "/ship" },
  { name: "away-but-open-prs", message: "away", prs: "yes", dirty: false, route: "/ship" },
  { name: "handoff", message: "leaving", prs: "maybe", dirty: "maybe", route: "/handoff" },
  { name: "catch-me-up", message: "away", prs: "no", dirty: false, quiet: true, route: "/catch-me-up" },
  { name: "dream", message: "lesson", prs: "maybe", dirty: "maybe", route: "/dream" },
  { name: "setup", message: "setup", prs: "no", dirty: "maybe", noMemory: true, route: "/cortex-next" },
  { name: "next-without-prs", message: "next", prs: "no", dirty: "maybe", route: "/cortex-next" },
];

const UPSTREAM = {
  ahead: (b) => `[origin/${b.name}: ahead ${2 + (b.sha.charCodeAt(0) % 3)}]`,
  "no-upstream": () => "",
  "in-sync-pr": (b) => `[origin/${b.name}]`,
  "merged-local": () => "",
  "gone-merged": (b) => `[origin/${b.name}: gone]`,
  "ahead-merged": (b) => `[origin/${b.name}: ahead ${1 + (b.sha.charCodeAt(1) % 3)}]`,
  "wt-dirty": () => "",
  "wt-clean": () => "",
};
const UNMERGED = new Set(["ahead", "no-upstream", "in-sync-pr"]);
const HIDDEN = new Set(["ahead", "no-upstream", "wt-dirty"]);
const WORKTREE = new Set(["wt-dirty", "wt-clean"]);
// Nothing mid-flight: what /catch-me-up needs, and all it may show.
const QUIET = ["merged-local", "gone-merged", "ahead-merged", "wt-clean"];

export function generate(seed) {
  const r = rng(seed);
  const v = pick(r, VARIANTS);
  const used = new Set(["master"]);
  const current = branchName(r, used);
  const dirty = v.dirty === "maybe" ? r() < 0.55 : v.dirty;
  const prs = v.prs === "maybe" ? r() < 0.6 : v.prs === "yes";

  let kinds = v.quiet
    ? shuffle(r, [...QUIET, "merged-local"])
    : shuffle(r, ["ahead", "no-upstream", "merged-local", "gone-merged", "ahead-merged", "ahead-merged", "no-upstream", "merged-local"]);
  kinds = kinds.slice(0, int(r, 2, 4));
  // At most one extra worktree, dirty more often than not — the case no branch test can see.
  if (!v.quiet && r() < 0.6) kinds.push(r() < 0.65 ? "wt-dirty" : "wt-clean");
  if (prs) kinds.push("in-sync-pr", ...(r() < 0.4 ? ["in-sync-pr"] : []));
  const branches = shuffle(r, kinds).map((kind) => ({ name: branchName(r, used), kind, sha: sha(r) }));

  const masterSha = sha(r);
  for (const b of branches) if (WORKTREE.has(b.kind)) {
    // A worktree branch with no commits of its own points at master's commit.
    b.sha = masterSha;
    b.path = pick(r, ["/tmp/wt-", "/home/dev/.cache/claude-wt/", "/var/folders/x7/T/wt-"]) + sha(r).slice(0, 4);
    b.dirt = b.kind === "wt-dirty" ? shuffle(r, [" M src/cart.ts", " M src/sync.ts", "?? src/cart.test.ts", " M README.md"]).slice(0, int(r, 1, 2)) : [];
  }

  const memory = v.noMemory ? null : [`2026-0${int(r, 6, 8)}-${String(int(r, 10, 28)).padStart(2, "0")}`];
  const files = ["src/app.ts", "src/cart.ts", "src/index.ts", "src/sync.ts", "README.md"];
  return {
    variant: v.name, route: v.route, message: pick(r, MESSAGES[v.message]), current, currentSha: sha(r), masterSha,
    currentUnmerged: r() < 0.5, dirty, dirtyFiles: dirty ? shuffle(r, files).slice(0, int(r, 1, 2)) : [],
    branches, memory, subjects: shuffle(r, SUBJECTS), prBase: int(r, 200, 400),
  };
}

export function render(s) {
  const row = (mark, name, rest) => `${mark} ${name.padEnd(26)} ${rest}`.replace(/\s+$/, "");
  const vv = [
    row("*", s.current, `${s.currentSha} [origin/${s.current}] ${s.subjects[0]}`),
    row(" ", "master", `${s.masterSha} [origin/master] ${s.subjects[1]}`),
    ...s.branches.map((b, i) => {
      const up = UPSTREAM[b.kind](b);
      return row(WORKTREE.has(b.kind) ? "+" : " ", b.name,
        [b.sha, b.path ? `(${b.path})` : "", up, s.subjects[(i + 2) % s.subjects.length]].filter(Boolean).join(" "));
    }),
  ];
  const noMerged = [...(s.currentUnmerged ? [`* ${s.current}`] : []), ...s.branches.filter((b) => UNMERGED.has(b.kind)).map((b) => `  ${b.name}`)];
  const prs = s.branches.filter((b) => b.kind === "in-sync-pr").map((b, i) => `${s.prBase + i}\t${s.subjects[(i + 3) % s.subjects.length]}\t${b.name}\tOPEN`);
  const wts = s.branches.filter((b) => WORKTREE.has(b.kind));
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
    "$ git worktree list",
    `/home/dev/app${" ".repeat(20)} ${s.currentSha} [${s.current}]`,
    ...wts.map((b) => `${b.path.padEnd(33)} ${b.sha} [${b.name}]`),
    ...wts.flatMap((b) => ["", `$ git -C ${b.path} status --short`, ...(b.dirt.length ? b.dirt : ["(clean)"])]),
    "",
    "$ ls .cortex/memory/",
    ...(s.memory ? s.memory.map((d) => `${d}.md`) : ["ls: cannot access '.cortex/memory/': No such file or directory"]),
    "",
    "$ gh pr list --state open",
    ...(prs.length ? prs : ["no open pull requests"]),
    "",
    "The current branch and master are in sync with their upstreams, except for any uncommitted changes shown above.",
    "Report the state, then end your reply with exactly these three lines:",
    "UNCOMMITTED: <branch this checkout's uncommitted changes are on>   (or: UNCOMMITTED: none)",
    "HIDDEN: <branch>, <branch>   — other branches holding work, committed or not, that exists only on this machine (or: HIDDEN: none)",
    "ROUTE: <the one ritual to route to: /ship, /handoff, /catch-me-up, /dream or /cortex-next>",
  ].join("\n");
}

export function truth(s) {
  return {
    uncommitted: s.dirty ? s.current : "none",
    hidden: s.branches.filter((b) => HIDDEN.has(b.kind)).map((b) => b.name),
    route: s.route,
  };
}

export function score(prediction, t) {
  const a = readAnswer(prediction, ["UNCOMMITTED", "HIDDEN", "ROUTE"]);
  const reasons = [];
  const unc = (a.UNCOMMITTED || "").replace(/\s+\(.*$/, "").trim();
  const uncOk = unc.toLowerCase() === t.uncommitted.toLowerCase();
  if (!uncOk) reasons.push(`UNCOMMITTED should be ${t.uncommitted}, got "${a.UNCOMMITTED || "(missing)"}"`);
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
