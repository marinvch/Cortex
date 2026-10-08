// lowered-bar.test.mjs — the lines of a diff where a change may have lowered the bar.
//
// A reviewer checks a change against the rules. The cheapest way to pass is to move the rule: add a
// suppression, skip the failing test, delete the assertion, turn the threshold down. Each of those
// is one line in a diff that otherwise reads as progress. `loweredBar` cites them and concludes
// nothing: a skip can be right. Every case below is a fixture diff, as `git diff -U0 -M` prints it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loweredBar } from "../lib/lowered-bar.mjs";

/** A one-file diff. `hunks` is `[[oldStart, newStart, ["-old", "+new", ...]], ...]`. */
function diff(path, hunks, { deleted = false, renamedFrom = null } = {}) {
  const head = [`diff --git a/${renamedFrom ?? path} b/${path}`];
  if (deleted) head.push("deleted file mode 100644");
  if (renamedFrom) head.push("similarity index 90%", `rename from ${renamedFrom}`, `rename to ${path}`);
  head.push("index 1111111..2222222 100644", `--- a/${renamedFrom ?? path}`, deleted ? "+++ /dev/null" : `+++ b/${path}`);
  for (const [o, n, lines] of hunks) {
    const minus = lines.filter((l) => l.startsWith("-")).length;
    const plus = lines.filter((l) => l.startsWith("+")).length;
    head.push(`@@ -${o},${minus} +${n},${plus} @@`, ...lines);
  }
  return head.join("\n") + "\n";
}
const kinds = (d) => loweredBar(d).map((f) => f.kind);

// --- 1. a suppression is added ---------------------------------------------------------------------

test("an added suppression is cited with its file, its line in the new file, and its text", () => {
  const r = loweredBar(diff("src/pay.ts", [[10, 10, ["+  // eslint-disable-next-line no-explicit-any", "+  const x: any = y;"]]]));
  assert.deepEqual(r, [{ kind: "suppression", path: "src/pay.ts", line: 10, side: "added", text: "// eslint-disable-next-line no-explicit-any", note: "a check is switched off here" }]);
});

test("the suppressions of each ecosystem are recognised", () => {
  for (const [path, line] of [
    ["a.ts", "// @ts-ignore"],
    ["a.ts", "// @ts-expect-error wrong types upstream"],
    ["a.ts", "/* eslint-disable */"],
    ["a.ts", "// biome-ignore lint/suspicious/noExplicitAny: later"],
    ["a.js", "/* istanbul ignore next */"],
    ["a.js", "/* c8 ignore start */"],
    ["a.py", "import x  # noqa: F401"],
    ["a.py", "y = f()  # type: ignore[arg-type]"],
    ["a.py", "# pylint: disable=too-many-locals"],
    ["a.py", "    except Exception:  # pragma: no cover"],
    ["a.go", "	x := f() //nolint:errcheck"],
    ["a.go", "	h := md5.New() // #nosec G401"],
    ["a.rs", "#[allow(dead_code)]"],
    ["A.java", '@SuppressWarnings("unchecked")'],
    ["a.kt", '@Suppress("UNCHECKED_CAST")'],
    ["a.rb", "# rubocop:disable Metrics/MethodLength"],
    ["a.sh", "# shellcheck disable=SC2086"],
    ["a.php", "// phpcs:ignore"],
  ]) {
    assert.deepEqual(kinds(diff(path, [[1, 1, [`+${line}`]]])), ["suppression"], `${path}: ${line}`);
  }
});

test("a suppression that only moved, or sits in a document, is not cited", () => {
  // Reindented in the same file: one removed, the same one added.
  assert.deepEqual(kinds(diff("a.ts", [[4, 4, ["-// @ts-ignore", "+    // @ts-ignore"]]])), []);
  // Prose about suppressions is not one.
  assert.deepEqual(kinds(diff("docs/lint.md", [[1, 1, ["+Use `// eslint-disable-next-line` sparingly."]]])), []);
  // A word that merely contains one.
  assert.deepEqual(kinds(diff("a.py", [[1, 1, ["+noqa_count = 3"]]])), []);
  // A removed suppression raises the bar.
  assert.deepEqual(kinds(diff("a.ts", [[4, 4, ["-// @ts-ignore"]]])), []);
});

// --- 2. a test is skipped, or deleted ---------------------------------------------------------------

test("a skipped test is cited, in the test file", () => {
  const r = loweredBar(diff("src/pay.test.ts", [[20, 20, ["-  it('refunds twice', async () => {", "+  it.skip('refunds twice', async () => {"]]]));
  assert.deepEqual(r, [{ kind: "skipped-test", path: "src/pay.test.ts", line: 20, side: "added", text: "it.skip('refunds twice', async () => {", note: "this test no longer runs" }]);
});

test("the skips of each runner are recognised, and a focus is one too", () => {
  for (const [path, line] of [
    ["a.test.js", "describe.skip('billing', () => {"],
    ["a.test.js", "xit('rounds', () => {"],
    ["a.test.js", "xdescribe('billing', () => {"],
    ["a.test.js", "test.skipIf(isCI)('uploads', () => {"],
    ["a.test.js", "it.only('rounds', () => {"],
    ["a.spec.ts", "fdescribe('billing', () => {"],
    ["tests/test_pay.py", "@pytest.mark.skip(reason='flaky')"],
    ["tests/test_pay.py", "@pytest.mark.xfail"],
    ["tests/test_pay.py", "@unittest.skip('later')"],
    ["tests/test_pay.py", "        pytest.skip('no network')"],
    ["pay_test.go", '	t.Skip("flaky on CI")'],
    ["src/test/java/PayTest.java", "    @Disabled"],
    ["src/test/java/PayTest.java", '    @Ignore("later")'],
    ["tests/pay.rs", "#[ignore]"],
  ]) {
    assert.deepEqual(kinds(diff(path, [[1, 1, [`+${line}`]]])), ["skipped-test"], `${path}: ${line}`);
  }
});

test("skip syntax outside a test file, or one that only moved, is not cited", () => {
  assert.deepEqual(kinds(diff("src/queue.ts", [[1, 1, ["+  items.skip(3);", "+  t.Skip()"]]])), []);
  assert.deepEqual(kinds(diff("a.test.js", [[1, 1, ["-it.skip('a', () => {", "+  it.skip('a', () => {"]]])), []);
});

test("a deleted test file is cited, and a renamed one is not", () => {
  const gone = loweredBar(diff("src/pay.test.ts", [[1, 0, ["-it('refunds', () => {", "-  expect(refund()).toBe(1);", "-});"]]], { deleted: true }));
  assert.deepEqual(gone, [{ kind: "deleted-test", path: "src/pay.test.ts", line: null, side: "removed", text: "", note: "this test file is deleted" }]);
  assert.deepEqual(kinds(diff("src/billing/pay.test.ts", [], { renamedFrom: "src/pay.test.ts" })), []);
  // A deleted source file is not this check's business.
  assert.deepEqual(kinds(diff("src/pay.ts", [[1, 0, ["-export const x = 1;"]]], { deleted: true })), []);
});

test("test declarations removed from a file that stays are cited once, at the first, with the count", () => {
  const r = loweredBar(
    diff("src/pay.test.ts", [
      [10, 9, ["-it('refunds twice', () => {", "-  expect(refund(2)).toBe(2);", "-});"]],
      [30, 26, ["-test('rounds down', () => {", "-  expect(round(1.9)).toBe(1);", "-});"]],
    ]),
  );
  assert.deepEqual(r, [{ kind: "deleted-test", path: "src/pay.test.ts", line: 10, side: "removed", text: "it('refunds twice', () => {", note: "2 test declarations removed, 0 added" }]);
});

test("a test that was rewritten, or replaced by as many, is not cited", () => {
  assert.deepEqual(kinds(diff("a.test.js", [[10, 10, ["-it('refunds', () => {", "+it('refunds a paid order', () => {"]]])), []);
  assert.deepEqual(kinds(diff("tests/test_a.py", [[5, 5, ["-def test_old():", "-    assert f() == 1", "+def test_new():", "+    assert f() == 1"]]])), []);
});

// --- 3. an assertion is stripped --------------------------------------------------------------------

test("assertions removed from a test that stays are cited at the first, with the count", () => {
  const r = loweredBar(diff("src/pay.test.ts", [[12, 12, ["-    expect(res.status).toBe(200);", "-    expect(res.body.total).toBe(42);", "+    expect(res.status).toBeDefined();"]]]));
  assert.deepEqual(r, [{ kind: "stripped-assertion", path: "src/pay.test.ts", line: 12, side: "removed", text: "expect(res.status).toBe(200);", note: "2 assertion lines removed, 1 added" }]);
});

test("a removed line is cited by its own line in the old file, not the hunk's first", () => {
  const [f] = loweredBar(diff("a.test.js", [[12, 12, ["-    const res = await get('/pay');", "-    await settle();", "-    expect(res.status).toBe(200);"]]]));
  assert.equal(f.line, 14);
});

test("the assertions of each ecosystem are counted", () => {
  for (const [path, line] of [
    ["tests/test_a.py", "    assert total == 42"],
    ["tests/test_a.py", "    self.assertEqual(total, 42)"],
    ["a_test.go", "	assert.Equal(t, 42, total)"],
    ["a_test.go", "	require.NoError(t, err)"],
    ["src/test/java/ATest.java", "        assertEquals(42, total);"],
    ["src/test/java/ATest.java", "        assertThat(total).isEqualTo(42);"],
    ["a.test.js", "  assert.strictEqual(total, 42);"],
    ["a.spec.js", "  total.should.equal(42);"],
    ["tests/a.rs", "    assert_eq!(total, 42);"],
  ]) {
    assert.deepEqual(kinds(diff(path, [[5, 5, [`-${line}`]]])), ["stripped-assertion"], `${path}: ${line}`);
  }
});

test("assertions that went with their test, were swapped one for one, or left a source file are not cited", () => {
  // The whole test went: that is the deleted-test citation, said once.
  assert.deepEqual(kinds(diff("a.test.js", [[10, 9, ["-it('refunds', () => {", "-  expect(refund()).toBe(1);", "-});"]]])), ["deleted-test"]);
  assert.deepEqual(kinds(diff("a.test.js", [[10, 10, ["-  expect(a).toBe(1);", "+  expect(a).toEqual(1);"]]])), []);
  assert.deepEqual(kinds(diff("src/guard.py", [[3, 3, ["-    assert user is not None"]]])), []);
});

// --- 4. a threshold is edited down ------------------------------------------------------------------

test("a coverage threshold edited down is cited with what it was", () => {
  const r = loweredBar(diff("jest.config.js", [[14, 14, ["-      branches: 80,", "+      branches: 60,"]]]));
  assert.deepEqual(r, [{ kind: "threshold", path: "jest.config.js", line: 14, side: "added", text: "branches: 60,", note: "was 80" }]);
});

test("thresholds in config files and on command lines, both directions that lower the bar", () => {
  for (const [path, was, now] of [
    ["package.json", '    "lines": 90,', '    "lines": 75,'],
    ["pyproject.toml", "fail_under = 85", "fail_under = 70"],
    [".coveragerc", "fail_under = 85", "fail_under = 70.5"],
    ["vitest.config.ts", "        statements: 80,", "        statements: 50,"],
    [".github/workflows/ci.yml", "        run: pytest --cov-fail-under=90", "        run: pytest --cov-fail-under=80"],
    ["package.json", '    "lint": "eslint . --max-warnings 0",', '    "lint": "eslint . --max-warnings 25",'],
    ["Makefile", "	eslint . --max-warnings=0", "	eslint . --max-warnings=10"],
    ["codecov.yml", "        target: 80%", "        target: 70%"],
  ]) {
    assert.deepEqual(kinds(diff(path, [[7, 7, [`-${was}`, `+${now}`]]])), ["threshold"], `${path}: ${was} → ${now}`);
  }
});

test("a threshold raised, an unrelated number, or a number in source code is not cited", () => {
  assert.deepEqual(kinds(diff("jest.config.js", [[14, 14, ["-      branches: 60,", "+      branches: 80,"]]])), []);
  assert.deepEqual(kinds(diff("package.json", [[3, 3, ['-  "version": "2.4.0",', '+  "version": "2.3.9",']]])), []);
  assert.deepEqual(kinds(diff("config.yml", [[3, 3, ["-port: 8080", "+port: 80"]]])), []);
  assert.deepEqual(kinds(diff("src/chart.ts", [[3, 3, ["-  lines: 80,", "+  lines: 40,"]]])), []);
  assert.deepEqual(kinds(diff("package.json", [[3, 3, ['-    "lint": "eslint . --max-warnings 25",', '+    "lint": "eslint . --max-warnings 0",']]])), []);
});

// --- the reader ---------------------------------------------------------------------------------------

test("line numbers follow the hunks, across several files, in path then line order", () => {
  const d =
    diff("b.test.js", [[40, 41, ["+it.skip('later', () => {});"]]]) +
    diff("a.ts", [
      [3, 3, ["-const a = 1;", "+const a = 2;"]],
      [20, 20, ["+const b = 1;", "+// @ts-ignore", "+const c: number = 'x';"]],
    ]);
  assert.deepEqual(loweredBar(d).map((f) => `${f.path}:${f.line} ${f.kind}`), ["a.ts:21 suppression", "b.test.js:41 skipped-test"]);
});

test("a path with spaces, CRLF line endings, and a binary file are read without a throw", () => {
  const d = diff("src/my file.test.js", [[1, 1, ["+it.skip('a', () => {});"]]]).replace(/\n/g, "\r\n") + "diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n";
  assert.deepEqual(loweredBar(d).map((f) => `${f.path}:${f.line}`), ["src/my file.test.js:1"]);
});

test("an empty diff, or none at all, cites nothing", () => {
  assert.deepEqual(loweredBar(""), []);
  assert.deepEqual(loweredBar(null), []);
});

test("a long line is cut, so one minified file cannot flood the report", () => {
  const [f] = loweredBar(diff("a.js", [[1, 1, [`+/* eslint-disable */${"x".repeat(500)}`]]]));
  assert.ok(f.text.length <= 161, String(f.text.length));
  assert.ok(f.text.endsWith("…"));
});

// --- what running it over real history taught (2,990 commits of ten public repos) -------------------

test("an import of an assertion library is not an assertion", () => {
  // spring-petclinic: three citations were `import org.assertj...` lines leaving a test file.
  for (const line of ["import org.assertj.core.util.Lists;", "import static org.assertj.core.api.Assertions.assertThat;", "from unittest import assertEqual", "const assert = require('node:assert');"]) {
    assert.deepEqual(kinds(diff("src/test/java/ATest.java", [[19, 19, [`-${line}`]]])), [], line);
  }
});

test("a runner hook is not a test declaration", () => {
  // got: `test.afterEach(() => {` removed was counted as a test removed.
  assert.deepEqual(kinds(diff("test/abort.ts", [[80, 80, ["-test.afterEach(() => {", "-test.beforeEach(async t => {"]]])), []);
});

test("in a test file `@ts-expect-error` is the test, and elsewhere it is a suppression", () => {
  // zustand's type tests: the line fails the build when the error stops happening.
  assert.deepEqual(kinds(diff("tests/types.test.tsx", [[212, 212, ["+    // @ts-expect-error `set` should enforce `count` as number."]]])), []);
  assert.deepEqual(kinds(diff("src/store.ts", [[12, 12, ["+    // @ts-expect-error upstream types"]]])), ["suppression"]);
  assert.deepEqual(kinds(diff("tests/types.test.tsx", [[212, 212, ["+    // @ts-ignore"]]])), ["suppression"]);
});

test("the note says what kind of skip it is", () => {
  const note = (path, line) => loweredBar(diff(path, [[1, 1, [`+${line}`]]]))[0].note;
  assert.equal(note("a.test.js", "it.skip('a', () => {"), "this test no longer runs");
  assert.equal(note("a.test.js", "test.skipIf(isCI)('a', () => {"), "this test is skipped on a condition");
  assert.equal(note("a.test.js", "const run = process.platform === 'darwin' ? test.skip : test;"), "this test is skipped on a condition");
  assert.equal(note("tests/test_a.py", "@pytest.mark.skipif(sys.platform == 'win32', reason='x')"), "this test is skipped on a condition");
  assert.equal(note("tests/test_a.py", "@pytest.mark.xfail("), "this test is now expected to fail");
  assert.equal(note("tests/test_a.py", "        pytest.skip('no network')"), "the test stops here when this line is reached");
  assert.equal(note("a_test.go", '	t.Skip("flaky")'), "the test stops here when this line is reached");
  assert.equal(note("a.test.js", "it.only('a', () => {"), "only this runs; the tests beside it do not");
});

test("a limit removed outright is cited, and one that moved within the file is not", () => {
  const r = loweredBar(diff("package.json", [[68, 68, ['-    "lint": "eslint src --max-warnings 0",', '+    "lint": "eslint src",']]]));
  assert.deepEqual(r, [{ kind: "threshold", path: "package.json", line: 68, side: "removed", text: '"lint": "eslint src --max-warnings 0",', note: "this limit of 0 is removed" }]);
  assert.deepEqual(kinds(diff("jest.config.js", [[14, 14, ["-      branches: 80,"]]])), ["threshold"]);
  // Moved to another script in the same file: still there.
  assert.deepEqual(kinds(diff("package.json", [[68, 68, ['-    "lint": "eslint src --max-warnings 0",', '+    "lint": "eslint src",']], [80, 80, ['+    "lint:ci": "eslint src --max-warnings 0",']]])), []);
  // A bare key means a limit only where limits are kept: `lines` in a chart is not one.
  assert.deepEqual(kinds(diff("src/chart.ts", [[3, 3, ["-  lines: 80,"]]])), []);
  // A number that is not a limit leaving a config file.
  assert.deepEqual(kinds(diff("package.json", [[3, 3, ['-  "port": 8080,']]])), []);
});
