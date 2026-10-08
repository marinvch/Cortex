// score.mjs is the one scorer: run.mjs calls scoreTask, and SkillOpt's adapter shells out to the
// command. Both paths are checked here, because a harness that scored differently from the other
// would train a skill against a number the baseline never saw.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scoreTask } from "../score.mjs";

const SCORER = fileURLToPath(new URL("../score.mjs", import.meta.url));
const truth = { uncommitted: "none", hidden: [], route: "/ship" };
const task = { id: "resume-test-001", skill: "resume", truth };
const RIGHT = "UNCOMMITTED: none\nHIDDEN: none\nROUTE: /ship";

test("scoreTask sends the reply to the task's own scenario and keeps the task's id", () => {
  assert.deepEqual(scoreTask(task, RIGHT), { id: "resume-test-001", hard: 1, soft: 1, reason: "correct" });
  assert.equal(scoreTask(task, "ROUTE: /dream").hard, 0);
});

test("a task for a skill with no scenario throws, and does not score 0", () => {
  assert.throws(() => scoreTask({ id: "x", skill: "no-such-skill", truth }, RIGHT), /no scorer for skill no-such-skill/);
});

test("as a command it reads one JSON per line and writes one result per line, skipping blank lines", () => {
  const input = [
    JSON.stringify({ task, prediction: RIGHT }),
    "",
    JSON.stringify({ task: { ...task, id: "resume-test-002" }, prediction: "ROUTE: /dream" }),
  ].join("\n");
  const run = spawnSync(process.execPath, [SCORER], { input, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const rows = run.stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => [r.id, r.hard]), [["resume-test-001", 1], ["resume-test-002", 0]]);
  assert.equal(rows[0].reason, "correct");
});

test("the command and the function give the same result for the same reply", () => {
  const prediction = "UNCOMMITTED: master\nHIDDEN: none\nROUTE: /ship";
  const run = spawnSync(process.execPath, [SCORER], { input: JSON.stringify({ task, prediction }), encoding: "utf8" });
  assert.deepEqual(JSON.parse(run.stdout), scoreTask(task, prediction));
});
