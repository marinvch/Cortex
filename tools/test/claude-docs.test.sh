# tools/cortex-claude-docs.mjs — does it notice when Anthropic's docs stop saying what Cortex ships?
#
# Offline: every case reads fixture pages through --pages, never the network. The pages are built
# from core/claude-code.js itself, then reformatted the way the real docs wrap a sentence — split
# across lines, a word turned into a link, a table row padded with spaces — so a pass here means the
# matcher reads through markdown, not that it compares a string to itself. Each mutation after that
# is one way the docs can move, and each must be caught as the right kind of failure.
#
# The second half is discovery: each fixture dir also holds the docs index (llms.txt) and the blog's
# front page (blog.html), built from tools/claude-docs-seen.json, so a clean dir lists exactly what
# Cortex has seen and every case after it adds, removes or breaks one thing.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

TOOL="$REPO_ROOT/tools/cortex-claude-docs.mjs"
cd "$WORK" || exit 1

# pages <dir> — one fixture page per source URL, stating every rule's evidence in docs-style markdown.
pages() {
  node --input-type=module -e '
    import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
    import { join } from "node:path";
    import { pathToFileURL } from "node:url";
    const [repo, dir] = process.argv.slice(1);
    const { RULES } = await import(pathToFileURL(join(repo, "core", "claude-code.js")).href);
    mkdirSync(dir, { recursive: true });
    const byPage = new Map();
    for (const r of RULES) {
      const name = r.source.replace(/^https:\/\/[^/]+\/docs\/en\//, "").replaceAll("/", "__");
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
    const seen = JSON.parse(readFileSync(join(repo, "tools", "claude-docs-seen.json"), "utf8"));
    const index = ["# Claude Code Docs", "", "## Section", ""];
    for (const p of seen.docs) index.push(`- [Title of ${p}](https://code.claude.com/docs/en/${p}.md): What it covers.`);
    index.push("", "- [French (220 pages)](https://code.claude.com/docs/_llms/fr.md): Another index.");
    writeFileSync(join(dir, "llms.txt"), index.join("\n"));
    const html = seen.blog.map((p, i) => `<a class="card" href="${i % 2 ? "https://claude.com" : ""}/resources/articles/${p}">Post</a>`);
    html.push(`<a href="/resources/articles/category/product-announcements">Category</a>`, `<a href="/resources/articles">All</a>`);
    writeFileSync(join(dir, "blog.html"), html.join("\n"));
    // The platform index: the watched pages Cortex has seen, among pages it does not watch.
    const platform = ["# Claude Platform", "", "- [Create a message](https://platform.claude.com/docs/en/api/messages/create.md) - Create"];
    for (const p of seen.platform ?? []) platform.push(`- [Title of ${p}](https://platform.claude.com/docs/en/${p}.md) - What it covers`);
    platform.push("- [A use case](https://platform.claude.com/docs/en/about-claude/use-case-guides/ticket-routing.md) - Guide");
    writeFileSync(join(dir, "platform-llms.txt"), platform.join("\n"));
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

# A fixture is named for the page's whole path: two pages called "overview" are two files.
pages samename
mv samename/plugins__mods__overview.md samename/overview.md
run samename --check
assert_eq "2" "$rc" "a page is read by its path, so another page's file with the same last segment is not it"
assert_contains "$out" "https://code.claude.com/docs/en/plugins/mods/overview — could not check" "and the unread page is named in full"

# --- discovery: pages the docs index or the blog lists that Cortex has not seen ------------------

run good --json
assert_contains "$out" '"newDocs": []' "a clean index reports nothing new"

pages newdoc
printf '\n- [Brand new](https://code.claude.com/docs/en/plugins/brand/new-page.md): A feature.\n' >> newdoc/llms.txt
run newdoc --check
assert_eq "3" "$rc" "a docs page not in the seen-list fails --check on its own exit code"
assert_contains "$out" "new    docs page: https://code.claude.com/docs/en/plugins/brand/new-page — Brand new" "and names it with its title"
assert_contains "$out" "cortex-claude-docs.mjs --accept" "and says how to record it"
run newdoc
assert_eq "0" "$rc" "without --check a new page reports but does not fail"

pages newpost
printf '\n<a href="/resources/articles/a-post-nobody-has-read">Post</a>\n' >> newpost/blog.html
run newpost --check
assert_eq "3" "$rc" "a blog post not in the seen-list fails --check the same way"
assert_contains "$out" "new    blog post: https://claude.com/resources/articles/a-post-nobody-has-read" "and names it"
assert_not_contains "$out" "blog post: https://claude.com/resources/articles/category" "a category link is not a post"

# The blog moved from /blog to /resources/articles on 2026-10; a link in the old form is the same post.
pages scrolled
printf '<a href="/blog/claude-code-mods">Post</a>\n' > scrolled/blog.html
run scrolled --check
assert_eq "0" "$rc" "a post that scrolled off the blog's front page is not a change"

pages oldform
printf '\n<a href="https://claude.com/blog/a-post-linked-the-old-way">Post</a>\n' >> oldform/blog.html
run oldform --check
assert_eq "3" "$rc" "a post linked under the old /blog path is still read"
assert_contains "$out" "blog post: https://claude.com/resources/articles/a-post-linked-the-old-way" "and is reported at the address that serves it"

pages removed
grep -v '/docs/en/quickstart.md' removed/llms.txt > removed/llms.tmp && mv removed/llms.tmp removed/llms.txt
run removed --check
assert_eq "0" "$rc" "a docs page that left the index is not a failure"
assert_contains "$out" "gone   docs page: https://code.claude.com/docs/en/quickstart" "but it is reported"

pages noindex
rm noindex/llms.txt
run noindex --check
assert_eq "2" "$rc" "an index that could not be read fails as unread, never as nothing new"
assert_contains "$out" "new pages went unlooked for" "and the summary says so"

pages emptied
printf '# Claude Code Docs\n\nMoved.\n' > emptied/llms.txt
run emptied --check
assert_eq "2" "$rc" "an index that reads but lists no pages is unread too"
assert_contains "$out" "no pages found in the index" "and says why"

pages both
grep -v "500 lines" both/skills.md > both/skills.tmp && mv both/skills.tmp both/skills.md
printf '\n- [Brand new](https://code.claude.com/docs/en/brand-new.md): A feature.\n' >> both/llms.txt
run both --check
assert_eq "1" "$rc" "a stale rule outranks a new page"
assert_contains "$out" "new    docs page" "and the new page is still listed"

# --accept writes the seen-list, so every case below points --seen at a copy.
cp "$REPO_ROOT/tools/claude-docs-seen.json" seen.json
run noindex --seen seen.json --accept
assert_eq "2" "$rc" "--accept refuses when an index was not read"
assert_eq "$(cat "$REPO_ROOT/tools/claude-docs-seen.json")" "$(cat seen.json)" "and leaves the seen-list as it was"
run newdoc --seen seen.json --accept
assert_eq "0" "$rc" "--accept records what is published"
run newdoc --seen seen.json --check
assert_eq "0" "$rc" "after which the same pages are no longer new"
run scrolled --seen seen.json --accept
run newpost --seen seen.json --check
assert_eq "3" "$rc" "accepting a short front page keeps the posts already seen"
assert_not_contains "$out" "blog post: https://claude.com/resources/articles/claude-code-mods" "so only the unread post is new"

# --- the platform docs index: three sections watched, the rest ignored ------------------------------
#
# platform.claude.com lists about 800 pages, most of them API reference. Cortex's own writing rests
# on three sections: agent skills, prompt engineering, and test-and-evaluate. A new page there is
# something to read; a new API reference page is not.

run good --json
assert_contains "$out" '"newPlatform": []' "a clean platform index reports nothing new"

pages newskillpage
printf '\n- [Skill evals](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/evaluating-skills.md) - How to evaluate a Skill\n' >> newskillpage/platform-llms.txt
run newskillpage --check
assert_eq "3" "$rc" "a new page in a watched platform section fails --check as a new page"
assert_contains "$out" "new    platform page: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/evaluating-skills — Skill evals" "and names it with its title"

pages newprompting
printf '\n- [Prompting Claude Opus 6](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-6.md)\n- [Grade it](https://platform.claude.com/docs/en/test-and-evaluate/grading.md) - Grading\n' >> newprompting/platform-llms.txt
run newprompting --check
assert_eq "3" "$rc" "the prompt-engineering and test-and-evaluate sections are watched too"
assert_contains "$out" "prompt-engineering/prompting-claude-opus-6 — Prompting Claude Opus 6" "a link with no description after it is still read"
assert_contains "$out" "test-and-evaluate/grading" "and the third section's page is named"

pages newapipage
printf '\n- [Create a thing](https://platform.claude.com/docs/en/api/beta/things/create.md) - Create\n- [A guide](https://platform.claude.com/docs/en/about-claude/use-case-guides/new-guide.md) - Guide\n' >> newapipage/platform-llms.txt
run newapipage --check
assert_eq "0" "$rc" "a new page outside the three sections is not reported"
assert_not_contains "$out" "things/create" "and is not named"

pages platformgone
grep -v 'agent-skills/quickstart.md' platformgone/platform-llms.txt > platformgone/p.tmp && mv platformgone/p.tmp platformgone/platform-llms.txt
run platformgone --check
assert_eq "0" "$rc" "a watched page that left the platform index is not a failure"
assert_contains "$out" "gone   platform page: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/quickstart" "but it is reported"

pages noplatform
rm noplatform/platform-llms.txt
run noplatform --check
assert_eq "2" "$rc" "a platform index that could not be read is unread, never nothing new"
assert_contains "$out" "https://platform.claude.com/llms.txt — could not check" "and it is named"

pages platformmoved
printf '# Claude Platform\n\n- [Create](https://platform.claude.com/docs/en/api/messages/create.md) - Create\n' > platformmoved/platform-llms.txt
run platformmoved --check
assert_eq "2" "$rc" "a platform index with no page in the watched sections is unread too: the sections moved"

cp "$REPO_ROOT/tools/claude-docs-seen.json" seen2.json
run newskillpage --seen seen2.json --accept
assert_eq "0" "$rc" "--accept records the platform pages too"
assert_contains "$out" "platform pages" "and says how many"
run newskillpage --seen seen2.json --check
assert_eq "0" "$rc" "after which the page is no longer new"
assert_contains "$(cat seen2.json)" "agents-and-tools/agent-skills/evaluating-skills" "and the seen-list holds it"
assert_not_contains "$(cat seen2.json)" "api/beta" "and holds no page outside the watched sections"

# A seen-list written before the platform index was watched has no platform key. That is every page
# unseen, which is what it is: say so rather than pass.
node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));delete s.platform;fs.writeFileSync("old-seen.json",JSON.stringify(s))' "$REPO_ROOT/tools/claude-docs-seen.json"
run good --seen old-seen.json --check
assert_eq "3" "$rc" "a seen-list with no platform pages reports them all as new"
