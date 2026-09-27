# Cortex holds its own Claude setup to the rules it reports on everyone else's.
#
# index/lib/claude-setup.mjs grades a repo's CLAUDE.md, skills, subagents and hooks against
# Anthropic's docs (core/claude-code.js). Run over this repository, it found all forty-five rituals
# carrying `capability:` as a top-level key — which Claude Code ignores without a word — while
# Cortex's own findings told users to put custom data under `metadata:`. A tool that reports a rule
# it does not follow teaches that the rule is optional, so here any finding fails the build (spec
# D3: a finding in a user's repo is advice, one in Cortex's is a defect).
#
# The fix for a red run is the repo, never the checker. Loosening a check to make this pass would
# loosen it for every user too.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

cd "$WORK" || exit 1

cat > "$WORK/own-rules.mjs" <<'NODE'
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [root, plant] = process.argv.slice(2);
const lib = (p) => import(pathToFileURL(join(root, p)).href);
const { buildIndex } = await lib("index/lib/build.mjs");
const { claudeSetupFindings } = await lib("index/lib/claude-setup.mjs");

const index = buildIndex(root);
const read = (p) => {
  let src;
  try { src = readFileSync(join(root, p), "utf8"); } catch { return null; }
  // --plant puts one known breach in memory — never on disk — so the test can see the check fire.
  if (plant && p === "skills/ship/SKILL.md") src = src.replace(/^---\r?\n/, "---\ncapability: judgment\n");
  return src;
};
const skills = index.files.filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f.path)).length;
console.log(`skills-seen ${skills}`);
for (const f of claudeSetupFindings(index, root, { read })) {
  console.log(`FINDING ${f.kind} — ${f.title}`);
  for (const e of f.evidence) console.log(`  ${e}`);
}
NODE

out="$(node "$WORK/own-rules.mjs" "$REPO_ROOT" 2>&1)"; rc=$?
assert_eq "0" "$rc" "the checker runs over this repository without crashing"

# An index that saw no skills would pass by checking nothing — the silent version of this test.
seen="$(printf '%s\n' "$out" | sed -n 's/^skills-seen //p')"
if [ "${seen:-0}" -gt 40 ]; then
  _pass "the checker walked the rituals ($seen SKILL.md files)"
else
  _fail "the checker walked the rituals" "saw ${seen:-none} — an empty walk would pass for the wrong reason"
fi

if printf '%s\n' "$out" | grep -q '^FINDING '; then
  _fail "Cortex's own Claude setup has no claude-setup findings" "$(printf '%s\n' "$out" | grep -v '^skills-seen ')"
else
  _pass "Cortex's own Claude setup has no claude-setup findings"
fi

# And it can fail: one top-level custom key, planted in memory, must surface as a finding.
planted="$(node "$WORK/own-rules.mjs" "$REPO_ROOT" plant 2>&1)"
assert_contains "$planted" "FINDING claude-setup/skill-unknown-key" "a planted top-level capability: key is reported"
assert_contains "$planted" "skills/ship/SKILL.md — capability" "and names the skill and the key"
