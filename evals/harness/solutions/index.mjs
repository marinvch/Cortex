// Reference patches for the four rule tasks, and the function that applies one to a built tree.
// They are used by the tests and by the stubbed dry run. No session ever sees them: a working copy
// holds the fixture and nothing from this directory.
//
//   good    does what the prompt asks and keeps the rule. Written from the base tree alone: it
//           touches no context-layer file, and it passes in both arms.
//   naive   does what the prompt asks and breaks the rule. It passes `works` and fails `rule`.
//
// Together they show that each task can be done without the layer and that each rule check can
// fire. The control has a good patch only: it has no rule to break.
//
// A patch is a list of operations on repo-relative paths:
//   { path, find, replace }   replace the one occurrence of `find`; an absent or repeated `find`
//                             throws, so a fixture edit that outdates a patch fails loudly
//   { path, content }         write the file
//   { path, remove: true }    delete it

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import discountGood from "./discount/good.mjs";
import discountNaive from "./discount/naive.mjs";
import cancelGood from "./cancel/good.mjs";
import cancelNaive from "./cancel/naive.mjs";
import noteGood from "./note/good.mjs";
import noteNaive from "./note/naive.mjs";
import byStatusGood from "./by-status/good.mjs";
import byStatusNaive from "./by-status/naive.mjs";
import searchEmptyGood from "./search-empty/good.mjs";

export const SOLUTIONS = {
  discount: { good: discountGood, naive: discountNaive },
  cancel: { good: cancelGood, naive: cancelNaive },
  note: { good: noteGood, naive: noteNaive },
  "by-status": { good: byStatusGood, naive: byStatusNaive },
  "search-empty": { good: searchEmptyGood },
};

export function applyPatch(dir, patch) {
  for (const op of patch) {
    const at = join(dir, ...op.path.split("/"));
    if (op.remove) { rmSync(at, { force: true }); continue; }
    if (typeof op.content === "string") {
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, op.content);
      continue;
    }
    const text = readFileSync(at, "utf8");
    const count = text.split(op.find).length - 1;
    if (count !== 1) throw new Error(`patch for ${op.path}: its text to replace appears ${count} times, not once`);
    writeFileSync(at, text.replace(op.find, () => op.replace));
  }
}
