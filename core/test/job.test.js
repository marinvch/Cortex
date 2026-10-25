import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_JOB, JOBS, JOB_SKILLS, isJob, jobOf } from "../job.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the five jobs, and a missing or unknown job reads as developer", () => {
  assert.deepEqual([...JOBS], ["developer", "architect", "lead", "pm", "qa"]);
  assert.equal(DEFAULT_JOB, "developer");
  for (const j of JOBS) assert.equal(isJob(j), true, j);
  for (const v of ["", "PM", " pm", "manager", null, undefined, 3, ["pm"]]) assert.equal(isJob(v), false, String(v));
  assert.equal(jobOf({ job: "pm" }), "pm");
  assert.equal(jobOf({ job: "Pm" }), "developer");
  assert.equal(jobOf({}), "developer");
  assert.equal(jobOf(null), "developer");
});

// The table is what a role pack is built from and what the rituals offer first. A name that is not
// a ritual is offered to nobody and packed for nobody, without a word.
test("every job has an offer, and every ritual it names exists under skills/", () => {
  assert.deepEqual(Object.keys(JOB_SKILLS), [...JOBS]);
  for (const [job, skills] of Object.entries(JOB_SKILLS)) {
    assert.ok(skills.length > 0, `${job} is offered something`);
    assert.equal(new Set(skills).size, skills.length, `${job} names no ritual twice`);
    for (const s of skills) assert.ok(existsSync(join(REPO_ROOT, "skills", s, "SKILL.md")), `${job}: skills/${s}/SKILL.md`);
  }
});
