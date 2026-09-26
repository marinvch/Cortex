# tools/cortex-claude-docs.mjs — does it notice when Anthropic's docs stop saying what Cortex ships?
#
# Offline: every case reads fixture pages through --pages, never the network. The pages are built
# from core/claude-code.js itself, then reformatted the way the real docs wrap a sentence — split
# across lines, a word turned into a link, a table row padded with spaces — so a pass here means the
# matcher reads through markdown, not that it compares a string to itself. Each mutation after that
# is one way the docs can move, and each must be caught as the right kind of failure.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

TOOL="$REPO_ROOT/tools/cortex-claude-docs.mjs"
cd "$WORK" || exit 1

# pages <dir> — one fixture page per source URL, stating every rule's evidence in docs-style markdown.
pages() {
  node --input-type=module -e '
    import { mkdirSync, writeFileSync } from "node:fs";
    import { join } from "node:path";
    import { pathToFileURL } from "node:url";
    const [repo, dir] = process.argv.slice(1);
    const { RULES } = await import(pathToFileURL(join(repo, "core", "claude-code.js")).href);
    mkdirSync(dir, { recursive: true });
    const byPage = new Map();
    for (const r of RULES) {
      const name = r.source.split("/").pop();
      const lines = byPage.get(name) ?? ["> ## Documentation Index", ""];
      if (r.evidence.startsWith("|")) lines.push(r.evidence.replace(/ \|/g, "     |"));
      else {
        const words = r.evidence.split(" ");
        words[1] = `[${words[1]}](/docs/en/glossary#x)`;
        const mid = Math.floor(words.length / 2);
        lines.push("Some text before. " + words.slice(0, mid).join(" "), words.slice(mid).join(" ") + " Some text after.", "");
      }
      if (r.table === "frontmatter") {
        lines.push("| Field | Required | Description |", "| :-- | :-- | :-- |");
        for (const k of r.value) lines.push(`| \`${k}\`   | No       | What ${k} does. |`);
        lines.push("");
      }
      byPage.set(name, lines);
    }
    for (const [name, lines] of byPage) writeFileSync(join(dir, `${name}.md`), lines.join("\n"));
  ' "$REPO_ROOT" "$1"
}

# run <dir> [flags...] — the tool against those pages; output in $out, exit code in $rc.
run() {
  local dir="$1"
  shift
  out="$(node "$TOOL" --pages "$dir" "$@" 2>&1)"
  rc=$?
}

pages good
run good --check
assert_eq "0" "$rc" "every rule's evidence is found through wrapping, links and table padding"
assert_contains "$out" "ok     https://code.claude.com/docs/en/skills" "and the page is reported ok"

pages gone
grep -v "500 lines" gone/skills.md > gone/skills.tmp && mv gone/skills.tmp gone/skills.md
run gone --check
assert_eq "1" "$rc" "a sentence that left its page is stale, and --check fails"
assert_contains "$out" "STALE  skill.body.max-lines" "and names the rule"
run gone
assert_eq "0" "$rc" "without --check it reports but does not fail"

pages dropped
grep -v '| `paths`' dropped/skills.md > dropped/skills.tmp && mv dropped/skills.tmp dropped/skills.md
run dropped --check
assert_eq "1" "$rc" "a frontmatter key that left the reference table is stale"
assert_contains "$out" "keys no longer in the table: paths" "and says which key"

pages added
printf '\n| `brandNewField` | No | Something new. |\n' >> added/sub-agents.md
run added --check
assert_eq "0" "$rc" "a key the docs added is not a failure"
assert_contains "$out" "subagent.frontmatter.keys: the docs list brandNewField" "but it is reported as new"

pages offline
rm offline/hooks.md
run offline --check
assert_eq "2" "$rc" "a page that could not be read fails --check on its own exit code"
assert_contains "$out" "could not check" "and is called unchecked, never ok"
assert_contains "$out" "this is not a pass" "and the summary says so"

run gone --check --json
assert_eq "1" "$rc" "--json keeps the exit code"
assert_contains "$out" '"ok": false' "and the payload says the run is not ok"
assert_contains "$out" '"id": "skill.body.max-lines"' "and lists the stale rule"
