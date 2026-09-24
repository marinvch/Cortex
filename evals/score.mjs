#!/usr/bin/env node
// Score predictions against the ground truth the generator stored on each task.
//
//   one JSON per line on stdin: {"task": {id, skill, truth}, "prediction": "..."}
//   one JSON per line on stdout: {id, hard, soft, reason}
//
// `hard` is 1 only when every field is right; `soft` is partial credit in [0, 1]; `reason` names the
// rule an answer broke. This file is the one scorer — harnesses (SkillOpt's adapter, a CI job) shell
// out to it rather than reimplementing it.

import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { SKILLS } from "./skills.mjs";

export function scoreTask(task, prediction) {
  const mod = SKILLS[task.skill];
  if (!mod) throw new Error(`no scorer for skill ${task.skill}`);
  return { id: task.id, ...mod.score(prediction, task.truth) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    const { task, prediction } = JSON.parse(line);
    process.stdout.write(JSON.stringify(scoreTask(task, prediction)) + "\n");
  }
}
