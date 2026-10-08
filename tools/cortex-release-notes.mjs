#!/usr/bin/env node
// cortex-release-notes.mjs — one version's section of CHANGELOG.md, or a refusal.
//
//   node tools/cortex-release-notes.mjs 2.41.36                    # the section's body, on stdout
//   node tools/cortex-release-notes.mjs v2.41.36                   # a tag name works too
//   node tools/cortex-release-notes.mjs 2.41.36 --changelog <file>
//
// Exit 0 with the notes, 1 when the section is not safe to publish, 2 on a usage error. Writes
// nothing, and prints nothing on stdout unless it exits 0.
//
// A release's notes are its changelog section, and cutting one by hand means copying the text
// between two headings. The failure that copy cannot see is a heading that is nearly right: the
// section then runs on into the version below it, or holds a version nobody meant to publish. So
// this refuses anything it cannot bound exactly:
//
//   - the version has no section, or two;
//   - the section is empty;
//   - it ends at a `## ` heading that is not `## [x.y.z] — YYYY-MM-DD`, or at a version that is
//     not lower than its own;
//   - a line inside it looks like a version heading at the wrong level or with no space.
//
// Code fences are not tracked. The changelog has a prose line that starts with four backticks, and
// a fence tracker reads it as an opening fence and swallows eleven versions after it. A `## ` at
// the start of a line ends the section, fenced or not; a section that needs to quote one indents it.
//
// Maintainer-only. Users never run this.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const at = args.indexOf("--changelog");
const file = at === -1 ? fileURLToPath(new URL("../CHANGELOG.md", import.meta.url)) : args[at + 1];
const asked = args.find((a, i) => !a.startsWith("--") && (at === -1 || i !== at + 1));

const usage = (why) => {
  process.stderr.write(`${why}\nusage: node tools/cortex-release-notes.mjs <x.y.z> [--changelog <file>]\n`);
  process.exit(2);
};
const refuse = (why) => {
  process.stderr.write(`${why}\n`);
  process.exit(1);
};

const version = /^v?(\d+\.\d+\.\d+)$/.exec(asked ?? "")?.[1];
if (!version) usage(asked ? `"${asked}" is not a version` : "no version given");
if (!file) usage("--changelog needs a file");

let lines;
try {
  lines = readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/);
} catch (e) {
  usage(`could not read ${file} (${e.code ?? e.message})`);
}

const HEADING = /^## \[(\d+\.\d+\.\d+)\] — \d{4}-\d{2}-\d{2}$/;
// A line that names a version the way a heading would, whatever is wrong with the rest of it.
const NEARLY = /^\s*#{1,6}\s*\[?v?(\d+\.\d+\.\d+)\b/;
const LINK_DEFINITION = /^\[[^\]]+\]:\s+\S+$/;
const lower = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};

const starts = lines.flatMap((l, i) => (HEADING.exec(l)?.[1] === version ? [i] : []));
if (starts.length > 1) refuse(`${version} has a section twice, at lines ${starts.map((i) => i + 1).join(" and ")}`);
if (!starts.length) {
  const near = lines.findIndex((l) => NEARLY.exec(l)?.[1] === version);
  refuse(
    near === -1
      ? `no section for ${version} in ${file}`
      : `no section for ${version}: line ${near + 1} names it but is not "## [${version}] — YYYY-MM-DD"`,
  );
}

const start = starts[0];
let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
if (end === -1) {
  // The oldest section runs to the end of the file, less the link definitions that close it.
  end = lines.length;
  while (end > start + 1 && (lines[end - 1].trim() === "" || LINK_DEFINITION.test(lines[end - 1]))) end--;
} else {
  const next = HEADING.exec(lines[end])?.[1];
  if (!next) refuse(`the section for ${version} ends at line ${end + 1}, which is not a version heading: ${lines[end]}`);
  if (!lower(next, version)) refuse(`the section for ${version} ends at line ${end + 1}, version ${next}, which is not lower`);
}

const body = lines.slice(start + 1, end);
const stray = body.findIndex((l) => NEARLY.test(l));
if (stray !== -1) {
  refuse(`line ${start + 2 + stray} inside the section for ${version} looks like a version heading: ${body[stray].trim()}`);
}
const text = body.join("\n").replace(/^\s*\n/, "").trimEnd();
if (!text.trim()) refuse(`the section for ${version} is empty`);

process.stdout.write(`${text}\n`);
