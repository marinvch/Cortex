import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { placeholdersOf, renderTemplate, unfilledPlaceholders } from "../lib/placeholders.mjs";

const LOOP = fileURLToPath(new URL("../../templates/loop/", import.meta.url));

// --- what a placeholder is ----------------------------------------------------------------------

test("a placeholder is {{…}} not preceded by $ — GitHub Actions syntax is never one", () => {
  assert.deepEqual(placeholdersOf("a {{X}} b ${{ github.ref }} c {{Y}} {{X}}"), ["{{X}}", "{{Y}}"]);
  assert.deepEqual(placeholdersOf("{{project name}}"), ["{{project name}}"]);
});

// --- rendering ----------------------------------------------------------------------------------

test("a value replaces its placeholder, and ${{ }} is left exactly as written", () => {
  const t = "run: ${{ secrets.KEY }} Bash({{TEST_CMD}} *) ${{github.ref}}\n";
  assert.equal(renderTemplate(t, { TEST_CMD: "npm test" }), "run: ${{ secrets.KEY }} Bash(npm test *) ${{github.ref}}\n");
});

test("every occurrence is replaced, and a value is never re-scanned for placeholders", () => {
  assert.equal(renderTemplate("{{A}}-{{A}}\n", { A: "{{B}}", B: "no" }), "{{B}}-{{B}}\n");
});

test("a placeholder with no value is kept as written — how intent/TEMPLATE.md keeps {{TITLE}}", () => {
  assert.equal(renderTemplate("# {{TITLE}}\nby {{AUTHOR}}\n", {}), "# {{TITLE}}\nby {{AUTHOR}}\n");
});

test("an empty value on a line of its own removes the line — {{SETUP_STEPS}} 'delete it'", () => {
  const t = "steps:\n      - uses: checkout\n      {{SETUP_STEPS}}\n      - name: next\n";
  assert.equal(renderTemplate(t, { SETUP_STEPS: "" }), "steps:\n      - uses: checkout\n      - name: next\n");
  // Trailing spaces after the token are still a line of its own.
  assert.equal(renderTemplate("a\n  {{X}}  \nb\n", { X: "" }), "a\nb\n");
  // The last line, with no newline after it.
  assert.equal(renderTemplate("a\n{{X}}", { X: "" }), "a\n");
});

test("an empty value inside a line only empties the token — the line stays", () => {
  assert.equal(renderTemplate("This repo is the source. {{LEGACY_NOTE}}\nnext\n", { LEGACY_NOTE: "" }), "This repo is the source. \nnext\n");
  // Text after the token counts as much as text before it.
  assert.equal(renderTemplate("a\n{{OWNER}} reviews and accepts.\nb\n", { OWNER: "" }), "a\n reviews and accepts.\nb\n");
});

test("a multi-line value is inserted verbatim at the token — the line's indentation prefixes its first line only", () => {
  const t = "      {{SETUP_STEPS}}\n      - name: next\n";
  const v = "- uses: actions/setup-node@v4\n      - run: npm ci";
  assert.equal(renderTemplate(t, { SETUP_STEPS: v }), "      - uses: actions/setup-node@v4\n      - run: npm ci\n      - name: next\n");
});

test("a CRLF template and CRLF values render as LF", () => {
  assert.equal(renderTemplate("a\r\n{{X}}\r\nb\r\n", { X: "1\r\n2" }), "a\n1\n2\nb\n");
  assert.equal(renderTemplate("a\r\n{{X}}\r\nb\r\n", { X: "" }), "a\nb\n");
});

test("unfilledPlaceholders names what a render left, and ignores Actions syntax", () => {
  assert.deepEqual(unfilledPlaceholders("x {{A}} ${{ b }} {{C}}", { A: "1" }), ["C"]);
});

test("every real loop template renders to itself with no values", () => {
  // The identity is what makes a kept placeholder representable: no value, no change.
  for (const name of readdirSync(LOOP)) {
    const text = readFileSync(join(LOOP, name), "utf8").replace(/\r\n/g, "\n");
    assert.equal(renderTemplate(text, {}), text, name);
  }
});
