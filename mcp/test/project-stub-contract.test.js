// mcp/test/project-stub-contract.test.js
//
// The vault has two project-stub writers and one reader:
//
//   writers  tools/cortex-init.sh --register-to-vault   → projects/<slug>.md
//            tools/cortex-scan-projects.sh              → projects/<slug>.md
//   reader   tools/cortex.sh                            → the viewer's Repos tab
//
// The reader selects repo cards with `grep -lER '^path:'` and then pulls `path`, `stack`, `status`
// and `title` out of the frontmatter. A writer that omits `path:` is invisible in the viewer — no
// error, no warning, the card simply never appears. cortex-scan-projects.sh shipped that way: it
// wrote the path as `**Local path:**` in the body, so every repo it registered was silently
// missing from the Repos tab.
//
// This test pins the writers to the reader's contract. It is textual, like manifest-parity.test.js,
// because running the writers means provisioning git repos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p) => readFileSync(join(REPO_ROOT, ...p), "utf8");

// Frontmatter keys tools/cortex.sh reads for a repo card.
const REQUIRED_KEYS = ["path", "stack", "status", "title"];

test("cortex.sh still selects repo cards on a frontmatter path: key", () => {
  // If this assertion fails the reader changed, and the writer expectations below are stale.
  assert.match(
    read("tools", "cortex.sh"),
    /grep -lER '\^path:'/,
    "tools/cortex.sh must select repo cards with grep -lER '^path:' — update this test if the reader changed",
  );
});

/**
 * The frontmatter block a writer emits, as one string with real newlines.
 * One writer uses a heredoc (real newlines), the other a printf format string (literal `\n`),
 * so normalise before matching.
 */
function writerFrontmatter(src, startMarker) {
  const from = src.indexOf(startMarker);
  assert.ok(from !== -1, `could not find ${startMarker}`);
  const block = src.slice(from).replace(/\\n/g, "\n");
  // Frontmatter runs from the opening `---` to the closing one. The opening delimiter is not
  // anchored to a line start: the printf writer emits it mid-line, right after `printf -- "`.
  const m = block.match(/---\n([\s\S]*?)\n---/);
  assert.ok(m, `could not find a frontmatter block after ${startMarker}`);
  return m[1];
}

test("cortex-scan-projects.sh emits every key the Repos tab reads", () => {
  const fm = writerFrontmatter(read("tools", "cortex-scan-projects.sh"), 'cat > "$VAULT/projects/$slug.md"');
  for (const key of REQUIRED_KEYS) {
    assert.match(fm, new RegExp(`^${key}:`, "m"), `cortex-scan-projects.sh must write a '${key}:' frontmatter key`);
  }
});

test("cortex-init.sh --register-to-vault emits every key the Repos tab reads", () => {
  const fm = writerFrontmatter(read("tools", "cortex-init.sh"), 'printf -- "---');
  for (const key of REQUIRED_KEYS) {
    assert.match(fm, new RegExp(`^${key}:`, "m"), `cortex-init.sh must write a '${key}:' frontmatter key`);
  }
});
