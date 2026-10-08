// The lines of a diff where a change may have lowered the bar it is judged against.
//
// A change is reviewed against the rules: the tests, the linter, the coverage floor. The cheapest
// way through is to move the rule. Add a suppression, skip the failing test, delete the assertion,
// turn the threshold down. Each is one line in a diff that otherwise reads as progress, and each is
// exactly what a reviewer reading for logic does not look at.
//
// This finds those lines and cites them. It concludes nothing, per index/AGENTS.md: a skip can be
// right, and a suppression can be the honest fix. Whether this one is, is the reviewer's call, and
// the citation is what makes sure the call gets made.
//
// Four things are read, from the text of a unified diff (`git diff -U0 -M`):
//
//   suppression         a line added that switches a check off (`eslint-disable`, `# noqa`, ...)
//   skipped-test        a line added in a test file that skips a test, or focuses one
//   deleted-test        a test file deleted, or more test declarations removed than added
//   stripped-assertion  more assertion lines removed from a test file than added to it
//   threshold           a numeric floor edited down, an allowance edited up, or either removed
//
// What it cannot see: a test weakened by changing what it asserts, a rule switched off in a config
// by name, a job removed from CI. Silence here is not a pass.
//
// Pure: text in, citations out. The caller runs git.

import { categoryOf, detectLanguage, isTestPath } from "./langs.mjs";

const MAX_TEXT = 160;

// A check switched off in source. Each alternative is anchored on the comment or attribute syntax
// that makes it one, so a variable called `noqa_count` or prose about `@ts-ignore` does not match.
const SUPPRESSION = new RegExp(
  [
    String.raw`(?:\/\/|\/\*|\*)\s*eslint-disable(?:-next-line|-line)?\b`,
    String.raw`(?:\/\/|\/\*|\*)\s*@ts-(?:ignore|nocheck|expect-error)\b`,
    String.raw`(?:\/\/|\/\*|\*|#)\s*biome-ignore\b`,
    String.raw`(?:\/\/|\/\*|\*)\s*(?:istanbul|c8|v8)\s+ignore\b`,
    String.raw`#\s*noqa\b`,
    String.raw`#\s*type:\s*ignore\b`,
    String.raw`#\s*pylint:\s*disable\b`,
    String.raw`#\s*pragma:\s*no\s+cover\b`,
    String.raw`\/\/\s*nolint\b`,
    String.raw`(?:\/\/|#)\s*#?nosec\b`,
    String.raw`#!?\[allow\(`,
    String.raw`@SuppressWarnings\b`,
    String.raw`@Suppress\(`,
    String.raw`#\s*rubocop:disable\b`,
    String.raw`#\s*shellcheck\s+disable=`,
    String.raw`(?:\/\/|#|\/\*|\*)\s*(?:phpcs:ignore|@phpstan-ignore)`,
  ].join("|"),
);

// A test that no longer runs: skipped, expected to fail, or shut out by a focus on another.
const SKIP = new RegExp(
  [
    String.raw`\b(?:it|test|describe|context|suite)\.(?:skip|skipIf|only|todo\.skip)\b`,
    String.raw`\b(?:xit|xtest|xdescribe|xcontext|fit|fdescribe)\s*\(`,
    String.raw`@pytest\.mark\.(?:skip|skipif|xfail)\b`,
    String.raw`@unittest\.(?:skip|skipIf|skipUnless|expectedFailure)\b`,
    String.raw`\bpytest\.skip\(`,
    String.raw`\bself\.skipTest\(`,
    String.raw`\bt\.Skip(?:f|Now)?\(`,
    String.raw`@(?:Disabled|Ignore)\b`,
    String.raw`#\[ignore(?:\s*=|\])`,
  ].join("|"),
);

// Where a test starts.
const TEST_DECL = new RegExp(
  [
    // `it.skip(` and `test.each(` are still declarations: a test that was skipped was not removed.
    // `test.beforeEach(` is a hook and holds no test.
    String.raw`^\s*(?:it|test|xit|xtest|fit)(?:\.(?!before|after|setup|teardown)\w+)*\s*[(\`]`,
    String.raw`^\s*(?:async\s+)?def\s+test_\w*\s*\(`,
    String.raw`^\s*func\s+Test\w*\s*\(`,
    String.raw`^\s*@(?:Test|ParameterizedTest)\b`,
    String.raw`^\s*#\[(?:tokio::)?test\b`,
  ].join("|"),
);

// A line that asserts.
const ASSERTION = new RegExp(
  [
    String.raw`\bexpect\s*\(`,
    String.raw`\bassert\w*\s*[(!]`,
    String.raw`\bassert\.\w+\s*\(`,
    String.raw`^\s*assert\s+\S`,
    String.raw`\.should\b`,
    String.raw`\brequire\.\w+\(\s*t\b`,
  ].join("|"),
);

// A floor: lower is weaker. An allowance: higher is weaker.
const FLOOR = /^(?:branches|functions|lines|statements|threshold|target|fail[-_]?under|cov[-_]?fail[-_]?under|min(?:imum)?[-_]?coverage|coverage[-_]?threshold|min[-_]?(?:lines|branches|functions|statements))$/i;
const ALLOWANCE = /^(?:max[-_]?warnings|max[-_]?errors|allowed[-_]?failures)$/i;

// A bare `key: 80` means a threshold only where thresholds are kept. A `--flag 80` is one anywhere.
const THRESHOLD_FILE = /(?:^|\/)(?:package\.json|pyproject\.toml|setup\.cfg|tox\.ini|\.coveragerc|\.nycrc(?:\.json)?|codecov\.ya?ml|\.codecov\.ya?ml|sonar-project\.properties|[\w.-]*\.config\.[cm]?[jt]s|\.c8rc(?:\.json)?)$/i;

// In a test file `@ts-expect-error` is the test: it fails the build when the error stops happening.
const EXPECTED_ERROR = /@ts-expect-error\b/;

/** What a skip line does, in words: the reader should not have to know every runner. */
function skipNote(text) {
  if (/\.only\b|\b(?:fit|fdescribe)\s*\(/.test(text)) return "only this runs; the tests beside it do not";
  if (/xfail|expectedFailure/.test(text)) return "this test is now expected to fail";
  if (/skipIf|skipif|skipUnless|\?/.test(text)) return "this test is skipped on a condition";
  if (/pytest\.skip\(|skipTest\(|\bt\.Skip/.test(text)) return "the test stops here when this line is reached";
  return "this test no longer runs";
}

const isDoc = (path) => categoryOf(detectLanguage(path)) === "docs";
const cut = (s) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + "…" : s);

/** `[{ path, deleted, hunks: [{ removed: [{line, text}], added: [{line, text}] }] }]` from a unified diff. */
function parseDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;
  let oldLine = 0;
  let newLine = 0;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("diff --git ")) {
      file = { path: null, old: null, deleted: false, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      // The header. Paths come from `---`/`+++`, which hold the whole path even when it has spaces.
      // A rename with no content change has neither and no lines to read, so it is dropped below.
      if (line.startsWith("deleted file mode")) file.deleted = true;
      else if (line.startsWith("--- ")) file.old = line === "--- /dev/null" ? null : line.slice(4).replace(/^a\//, "").replace(/\t$/, "");
      else if (line.startsWith("+++ ")) {
        if (line === "+++ /dev/null") file.deleted = true;
        else file.path = line.slice(4).replace(/^b\//, "").replace(/\t$/, "");
      }
    }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) {
      hunk = { removed: [], added: [] };
      file.hunks.push(hunk);
      oldLine = Number(h[1]);
      newLine = Number(h[2]);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("-")) hunk.removed.push({ line: oldLine++, text: line.slice(1) });
    else if (line.startsWith("+")) hunk.added.push({ line: newLine++, text: line.slice(1) });
    else if (line.startsWith(" ")) {
      oldLine++;
      newLine++;
    }
  }
  for (const f of files) if (f.path == null) f.path = f.old;
  return files.filter((f) => f.path);
}

/** Every `key = number` and `--flag number` on a line, as `[key, number]`. */
function numbers(text) {
  const out = [];
  for (const m of text.matchAll(/--([a-z][a-z-]*)[= ]\s*(\d+(?:\.\d+)?)/gi)) out.push([m[1], Number(m[2]), "flag"]);
  for (const m of text.matchAll(/(?:^|[\s{,])["']?([A-Za-z_][\w-]*)["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)%?["']?\s*(?:[,}#;]|$)/g)) out.push([m[1], Number(m[2]), "key"]);
  return out;
}

/**
 * loweredBar(diffText) → `[{ kind, path, line, side, text, note }]`, in path then line order.
 *
 * `line` is in the new file for `side: "added"` and in the old file for `side: "removed"`; it is
 * `null` for a deleted file. `text` is the cited line, trimmed. Nothing here says the change is
 * wrong: every entry is a place to look.
 */
export function loweredBar(diffText) {
  const out = [];
  for (const f of parseDiff(diffText)) {
    const test = isTestPath(f.path);
    if (f.deleted) {
      if (test) out.push({ kind: "deleted-test", path: f.path, line: null, side: "removed", text: "", note: "this test file is deleted" });
      continue;
    }
    if (isDoc(f.path)) continue;
    const added = f.hunks.flatMap((h) => h.added);
    const removed = f.hunks.flatMap((h) => h.removed);
    // A line that left and came back, reindented or a few lines away, is a move and not a change.
    const left = new Map();
    for (const r of removed) left.set(r.text.trim(), (left.get(r.text.trim()) ?? 0) + 1);
    const moved = (text) => {
      const n = left.get(text.trim()) ?? 0;
      if (n) left.set(text.trim(), n - 1);
      return n > 0;
    };

    for (const a of added) {
      const isSuppression = SUPPRESSION.test(a.text) && !(test && EXPECTED_ERROR.test(a.text));
      const isSkip = test && SKIP.test(a.text);
      if (!isSuppression && !isSkip) continue;
      if (moved(a.text)) continue;
      // A line that is both (rare) is cited as the skip: the test not running is the larger fact.
      out.push(
        isSkip
          ? { kind: "skipped-test", path: f.path, line: a.line, side: "added", text: cut(a.text.trim()), note: skipNote(a.text) }
          : { kind: "suppression", path: f.path, line: a.line, side: "added", text: cut(a.text.trim()), note: "a check is switched off here" },
      );
    }

    if (test) {
      const declOut = removed.filter((r) => TEST_DECL.test(r.text));
      const declIn = added.filter((a) => TEST_DECL.test(a.text));
      if (declOut.length > declIn.length) {
        out.push({ kind: "deleted-test", path: f.path, line: declOut[0].line, side: "removed", text: cut(declOut[0].text.trim()), note: `${declOut.length} test declaration${declOut.length === 1 ? "" : "s"} removed, ${declIn.length} added` });
      } else {
        // Only when the tests stayed: assertions that left with their test are already cited above.
        const asserts = (l) => ASSERTION.test(l.text);
        const assertOut = removed.filter(asserts);
        const assertIn = added.filter(asserts);
        if (assertOut.length > assertIn.length) {
          out.push({ kind: "stripped-assertion", path: f.path, line: assertOut[0].line, side: "removed", text: cut(assertOut[0].text.trim()), note: `${assertOut.length} assertion line${assertOut.length === 1 ? "" : "s"} removed, ${assertIn.length} added` });
        }
      }
    }

    const bareKeys = THRESHOLD_FILE.test(f.path);
    const kept = new Set(added.flatMap((a) => numbers(a.text).map(([key, , form]) => `${form}:${key.toLowerCase()}`)));
    for (const h of f.hunks) {
      // A limit that left and did not come back anywhere in the file.
      for (const r of h.removed) {
        for (const [key, n, form] of numbers(r.text)) {
          if (form !== "flag" && !bareKeys) continue;
          if (!(FLOOR.test(key) || ALLOWANCE.test(key)) || kept.has(`${form}:${key.toLowerCase()}`)) continue;
          out.push({ kind: "threshold", path: f.path, line: r.line, side: "removed", text: cut(r.text.trim()), note: `this limit of ${n} is removed` });
        }
      }
      const was = new Map();
      for (const r of h.removed) for (const [key, n, form] of numbers(r.text)) if (form === "flag" || bareKeys) was.set(`${form}:${key.toLowerCase()}`, n);
      for (const a of h.added) {
        for (const [key, n, form] of numbers(a.text)) {
          const before = was.get(`${form}:${key.toLowerCase()}`);
          if (before === undefined) continue;
          if ((FLOOR.test(key) && n < before) || (ALLOWANCE.test(key) && n > before)) {
            out.push({ kind: "threshold", path: f.path, line: a.line, side: "added", text: cut(a.text.trim()), note: `was ${before}` });
          }
        }
      }
    }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : (a.line ?? 0) - (b.line ?? 0)));
}
