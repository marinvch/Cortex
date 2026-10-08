// The trigger check: each ritual's description holds the words people use to ask for it.
//
// Fixtures are three small rituals in a temp root, so each rule is shown failing on its own. The last
// tests run the real repo, and break a real description in memory to show the check would notice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkTriggers, ranker, readRituals, recordTriggers, tokens, TOP } from "../triggers.mjs";
import { main } from "../run.mjs";

const RITUALS = {
  resume: 'Pick up work in flight, before touching anything. Triggers — "what is left", "continue the work".',
  ship: 'Get finished work onto main, one pull request at a time. Triggers — "open a PR", "merge and continue".',
  daily: 'Open the note for today and surface what is due. Triggers — "good morning", "start my day".',
  handoff: "Compact this conversation for the next agent.",
};
const PROMPTS = {
  resume: { reach: ["what remains on the work in flight", "pick the work up again", "continue yesterday's work"], elsewhere: [{ prompt: "open a pull request and merge", owner: "ship" }] },
  ship: { reach: ["open a pull request", "merge the finished work onto main", "one more pull request to merge"], elsewhere: [{ prompt: "good morning, what is due", owner: "daily" }] },
  daily: { reach: ["morning, what is due today", "open the note for today", "time to begin the day"], elsewhere: [{ prompt: "continue the work in flight", owner: "resume" }] },
};

function world({ rituals = RITUALS, prompts = PROMPTS, record = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cortex-triggers-"));
  for (const [name, description] of Object.entries(rituals)) {
    mkdirSync(join(root, "skills", name), { recursive: true });
    const user = name === "handoff" ? "disable-model-invocation: true\n" : "";
    writeFileSync(join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n${user}---\n\n# ${name}\n`);
  }
  mkdirSync(join(root, "evals", "triggers"), { recursive: true });
  mkdirSync(join(root, "evals", "baselines"), { recursive: true });
  for (const [name, set] of Object.entries(prompts)) writeFileSync(join(root, "evals", "triggers", `${name}.json`), JSON.stringify(set));
  if (record) recordTriggers({ root });
  return root;
}
const done = (root) => rmSync(root, { recursive: true, force: true });
const problems = (root) => checkTriggers({ root }).problems;

test("words are compared without case, stop words or endings, in any script", () => {
  assert.deepEqual(tokens("What's LEFT on the branches?"), ["left", "branch"]);
  assert.deepEqual(tokens("продължи работата"), ["продължи", "работата"]);
  assert.deepEqual(tokens("docs/adr and AGENTS.md"), ["docs", "adr", "agent", "md"]);
});

test("a ritual a model may invoke needs prompts, and one only a person invokes needs none", () => {
  const root = world();
  assert.deepEqual(problems(root), []);
  assert.deepEqual(readRituals(root).map((r) => r.name), ["daily", "resume", "ship"]);
  rmSync(join(root, "evals", "triggers", "ship.json"));
  assert.match(problems(root).join("\n"), /ship: no evals\/triggers\/ship\.json/);
  done(root);
});

test("fewer than three reach prompts, or no elsewhere prompt, is a problem", () => {
  const root = world({ prompts: { ...PROMPTS, daily: { reach: ["time to begin the day"], elsewhere: [] } }, record: false });
  const p = problems(root).join("\n");
  assert.match(p, /daily: 1 reach prompt/);
  assert.match(p, /daily: no elsewhere prompt/);
  done(root);
});

test("removing a trigger word from a description fails the check", () => {
  const root = world();
  assert.deepEqual(problems(root), []);
  const file = join(root, "skills", "ship", "SKILL.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("one pull request at a time", "one at a time").replace('"open a PR", ', ""));
  // With three rituals nothing can fall out of the top three, so the rate is what notices: the
  // prompt that ranked ship first no longer does.
  const r = checkTriggers({ root });
  assert.ok(r.rows.find((x) => x.prompt === "open a pull request").position > 1);
  assert.match(r.problems.join("\n"), /8 of 9 reach prompts rank first \(0\.8889\), below the recorded 1/);
  done(root);
});

test("a reach prompt that ranks its ritual below the top three is a problem, whatever the rate", () => {
  const rituals = { aa: "Deploy the service.", bb: "Deploy the app.", cc: "Deploy the site.", zz: "Tidy the notes." };
  const set = (words) => ({ reach: [`${words} one`, `${words} two`, `${words} three`], elsewhere: [{ prompt: "tidy the notes", owner: "zz" }] });
  const prompts = { aa: set("deploy service"), bb: set("deploy app"), cc: set("deploy site"), zz: { reach: ["deploy it", "tidy notes today", "notes to tidy"], elsewhere: [{ prompt: "deploy the site", owner: "cc" }] } };
  const root = world({ rituals, prompts, record: false });
  const r = checkTriggers({ root });
  assert.equal(r.rows.find((x) => x.prompt === "deploy it").position, 4);
  assert.match(r.problems.join("\n"), /zz: "deploy it" ranks it 4, below aa, bb, cc — the description does not hold the words/);
  assert.equal(recordTriggers({ root }).written, false, "and no rate is recorded while it stands");
  done(root);
});

test("an elsewhere prompt fails when its owner does not outrank the ritual", () => {
  const root = world({ prompts: { ...PROMPTS, daily: { ...PROMPTS.daily, elsewhere: [{ prompt: "open the note for today", owner: "resume" }] } }, record: false });
  assert.match(problems(root).join("\n"), /daily: "open the note for today" belongs to \/resume, which ranks \d while \/daily ranks 1/);
  done(root);
});

test("an elsewhere prompt must name another ritual a model may invoke", () => {
  for (const owner of ["handoff", "daily", "nope"]) {
    const root = world({ prompts: { ...PROMPTS, daily: { ...PROMPTS.daily, elsewhere: [{ prompt: "x", owner }] } }, record: false });
    assert.match(problems(root).join("\n"), /names owner/, owner);
    done(root);
  }
});

test("a reach prompt that is one of the description's own quoted triggers proves nothing", () => {
  const root = world({ prompts: { ...PROMPTS, daily: { ...PROMPTS.daily, reach: ["Start my day!", "morning, what is due today", "open the note for today"] } }, record: false });
  assert.match(problems(root).join("\n"), /daily: "Start my day!" is one of the description's own quoted triggers/);
  done(root);
});

test("a prompt file for a ritual that is not there is reported", () => {
  const root = world();
  writeFileSync(join(root, "evals", "triggers", "gone.json"), "{}");
  assert.match(problems(root).join("\n"), /evals\/triggers\/gone\.json: no model-invocable ritual is named gone/);
  done(root);
});

test("the rank-1 rate is recorded, checked, and only raised", () => {
  // `daily`'s first prompt ranks second: "work" and "today" split it with resume.
  const weak = { ...PROMPTS, daily: { ...PROMPTS.daily, reach: ["continue the work for today", "open the note for today", "time to begin the day"] } };
  const root = world({ prompts: weak, record: false });
  assert.match(problems(root).join("\n"), /no evals\/baselines\/triggers\.json/);
  const first = recordTriggers({ root });
  assert.equal(first.written, true);
  assert.ok(first.rank1Rate < 1, `expected a prompt not ranked first, got ${first.rank1Rate}`);
  assert.deepEqual(problems(root), []);

  // Better prompts raise it, and the new rate is written.
  writeFileSync(join(root, "evals", "triggers", "daily.json"), JSON.stringify(PROMPTS.daily));
  const raised = recordTriggers({ root });
  assert.equal(raised.rank1Rate, 1);
  assert.equal(raised.was, first.rank1Rate);

  // Going back is a failure of the check, and --record will not write the lower rate.
  writeFileSync(join(root, "evals", "triggers", "daily.json"), JSON.stringify(weak.daily));
  assert.match(problems(root).join("\n"), /below the recorded 1 — the rate is only raised/);
  assert.equal(recordTriggers({ root }).written, false);
  assert.equal(JSON.parse(readFileSync(join(root, "evals", "baselines", "triggers.json"), "utf8")).rank1Rate, 1);
  done(root);
});

test("the order is the same on every run, and a tie goes to the earlier name", () => {
  const { rank } = ranker([{ name: "b", description: "alpha" }, { name: "a", description: "alpha" }, { name: "c", description: "beta" }]);
  assert.deepEqual(rank("alpha"), ["a", "b", "c"]);
  assert.deepEqual(rank("nothing in common"), ["a", "b", "c"]);
});

// ── the real repo ─────────────────────────────────────────────────────────────────────────────────

test("every model-invocable ritual in this repo has prompts, and they pass", () => {
  const r = checkTriggers();
  assert.deepEqual(r.problems, []);
  assert.ok(r.reach >= readRituals().length * 3);
  assert.ok(r.rows.filter((x) => x.kind === "reach").every((x) => x.position >= 1 && x.position <= TOP));
});

test("a real description stripped of the words a prompt uses stops ranking for it", () => {
  const rituals = readRituals();
  const before = ranker(rituals).rank("this test is flaky and I can't work out why");
  assert.ok(before.indexOf("diagnosing-bugs") < TOP);
  const stripped = rituals.map((r) => (r.name === "diagnosing-bugs" ? { ...r, description: r.description.replace(/flaky/g, "").replace(/untested/g, "") } : r));
  const after = ranker(stripped).rank("this test is flaky and I can't work out why");
  assert.ok(after.indexOf("diagnosing-bugs") > before.indexOf("diagnosing-bugs"));
});

test("`run.mjs --check` fails on a trigger problem", async () => {
  const lines = [];
  const deps = { log: (m) => lines.push(m), error: (m) => lines.push(m) };
  assert.equal(await main(["--check"], { ...deps, checkTriggers: () => ({ ok: false, problems: ["ship: a trigger problem"], rank1: 0, reach: 1, rate: 0 }) }), 1);
  assert.match(lines.join("\n"), /ship: a trigger problem/);
  assert.equal(await main(["--check"], deps), 0, lines.join("\n"));
});
