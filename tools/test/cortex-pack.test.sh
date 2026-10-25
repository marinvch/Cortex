# tools/cortex-pack.mjs — a role pack: what goes in, that every skill in it is portable, and that
# it is the same bytes every time and carries nothing private.
#
# The design's rule (docs/specs/2026-10-25-role-packs-design.md, R2): a skill in a pack must not
# depend on running repo scripts, and a test fails on a pack skill that names a `node tools/` or
# `node index/` command. "Portable" is defined in the header of tools/_pack.mjs; each of its six
# points has a fixture below that fails it, beside one that passes.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

TOOL="$REPO_ROOT/tools/cortex-pack.mjs"
LIB="$REPO_ROOT/tools/_pack.mjs"
cd "$WORK" || exit 1

# --- this repository --------------------------------------------------------------------------------

out="$(node "$TOOL" --check 2>&1)"; rc=$?
assert_eq "0" "$rc" "every pack of this repo builds, and checks clean"
assert_contains "$out" "every pack builds, every skill in one is portable, every zip reads back" "and it says what it checked"

out="$(node "$TOOL" --help 2>&1)"; rc=$?
assert_eq "0" "$rc" "--help exits 0"
assert_contains "$out" "one of developer, architect, lead, pm, qa" "and names the five jobs"
out="$(node "$TOOL" manager 2>&1)"; rc=$?
assert_eq "2" "$rc" "an unknown job is a bad argument"
assert_contains "$out" "unknown job 'manager'" "and is named"
out="$(node "$TOOL" 2>&1)"; rc=$?
assert_eq "2" "$rc" "no job and no --all is a bad argument"

# What each pack holds today, pinned. A skill that gains a `node tools/` line drops out of its pack
# without an error, so the drop has to show up somewhere: here.
for pair in "developer:" "architect:challenge-plan,define-terms,design-spec" "lead:set-profile" "pm:challenge-plan" "qa:"; do
  job="${pair%%:*}"; want="${pair#*:}"
  got="$(node "$TOOL" "$job" --list --json | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).skills.join(","))')"
  assert_eq "$want" "$got" "the $job pack holds: ${want:-nothing portable yet}"
done

# --- writing, twice -----------------------------------------------------------------------------------

node "$TOOL" --all --out "$WORK/a" > "$WORK/a.log" 2>&1; rc=$?
assert_eq "0" "$rc" "--all writes every pack"
node "$TOOL" --all --out "$WORK/b" > /dev/null 2>&1
version="$(tr -d '\r\n' < "$REPO_ROOT/VERSION")"
for job in developer architect lead pm qa; do
  [ -f "$WORK/a/cortex-pack-$job-$version.zip" ] && _pass "the $job pack zip is written" || _fail "the $job pack zip is written" "no $WORK/a/cortex-pack-$job-$version.zip"
  [ -f "$WORK/a/cortex-pack-$job/pack.json" ] && _pass "beside its folder" || _fail "beside its folder" "no pack.json"
done
assert_eq "" "$(diff -r "$WORK/a" "$WORK/b" 2>&1)" "two builds are the same bytes, zips included"

# A rebuild over a pack this tool wrote replaces it; anything else in the way is refused.
node "$TOOL" pm --out "$WORK/a" > /dev/null 2>&1; rc=$?
assert_eq "0" "$rc" "a rebuild over its own pack replaces it"
mkdir -p "$WORK/c/cortex-pack-pm"
echo "mine" > "$WORK/c/cortex-pack-pm/notes.txt"
out="$(node "$TOOL" pm --out "$WORK/c" 2>&1)"; rc=$?
assert_eq "1" "$rc" "a folder it did not write is refused"
assert_eq "mine" "$(cat "$WORK/c/cortex-pack-pm/notes.txt")" "and left as it was"
assert_contains "$out" "Nothing was written" "and it says so"

# The rule the design names, applied to what was written, not to what the code meant to write.
hits="$(grep -rlE 'CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR|node [^ ]*(tools|index|mcp)/' "$WORK"/a/*/skills 2>/dev/null)"
assert_eq "" "$hits" "no packed skill names a Claude Code variable or runs node tools/, index/ or mcp/"
hits="$(grep -rlE '^(effort|disable-model-invocation|argument-hint):' "$WORK"/a/*/skills 2>/dev/null)"
assert_eq "" "$hits" "and no packed skill keeps a Claude Code frontmatter key"
assert_contains "$(head -6 "$REPO_ROOT/skills/challenge-plan/SKILL.md")" "effort:" "(the source of challenge-plan has one, so the adaptation was tested)"

# Links out of a skill's folder name the file on the release.
assert_contains "$(cat "$WORK/a/cortex-pack-lead/skills/set-profile/SKILL.md")" \
  "(https://github.com/marinvch/Cortex/blob/v$version/docs/adr/0015-a-profile-is-the-world-an-install-serves.md)" \
  "a link out of the skill's folder names the file on the release"

# Nothing private: no path of this machine or this checkout, and nothing the credential scan reads.
home_unix="$(cd ~ && pwd)"
leaks="$(grep -rlF -e "$REPO_ROOT" -e "$home_unix" -e "${USERPROFILE:-/no/such/profile}" "$WORK/a" 2>/dev/null)"
assert_eq "" "$leaks" "no pack names a path on the machine that built it"
scan="$(node --input-type=module -e '
  import { readdirSync, readFileSync, statSync } from "node:fs";
  import { join } from "node:path";
  import { pathToFileURL } from "node:url";
  const [repo, dir] = process.argv.slice(1);
  const { scan } = await import(pathToFileURL(join(repo, "core", "scrub.js")).href);
  const walk = (d) => readdirSync(d).flatMap((n) => statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]);
  const bad = walk(dir).filter((f) => !f.endsWith(".zip") && scan(readFileSync(f, "utf8")).length);
  console.log(bad.join("\n"));
' "$REPO_ROOT" "$WORK/a")"
assert_eq "" "$scan" "and no file in any pack holds what the credential scan reads as a secret"
assert_contains "$(cat "$WORK/a/cortex-pack-pm/mcp/claude-desktop.json")" "<path to your Cortex checkout>/mcp/server.js" "the MCP entries carry placeholders, not values"

# The zips open with a tool that is not ours, when there is one.
if command -v unzip > /dev/null 2>&1; then
  listing="$(unzip -l "$WORK/a/cortex-pack-architect/zips/define-terms.zip" 2>&1)"
  assert_contains "$listing" "define-terms/SKILL.md" "unzip reads a skill zip, with the skill's folder at its root"
  assert_eq "0" "$(unzip -tq "$WORK/a/cortex-pack-pm-$version.zip" > /dev/null 2>&1; echo $?)" "and tests a pack zip clean"
fi

# --- the portable test can fail ----------------------------------------------------------------------
#
# One fixture skill per point of the definition, judged by the library itself.
F="$WORK/fixture"
mkdir -p "$F/skills" "$F/docs" "$F/.claude-plugin"
printf '1.2.3\n' > "$F/VERSION"
printf '{ "repository": "https://github.com/example-org/cortex" }\n' > "$F/.claude-plugin/plugin.json"
printf '# A decision\n' > "$F/docs/adr.md"
skill() { # name frontmatter-extra body
  mkdir -p "$F/skills/$1"
  printf -- '---\nname: %s\ndescription: A fixture skill that exists to be judged by the portable-skill test.\n%s---\n\n%s\n' "$1" "$2" "$3" > "$F/skills/$1/SKILL.md"
}
skill clean "effort: low
metadata:
  capability: judgment
" 'Read [the decision](../../docs/adr.md) and [the format](FORMAT.md). Mention `/other-ritual` freely.'
printf '# Format\n' > "$F/skills/clean/FORMAT.md"
skill plugin-root "" 'Run `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-index.mjs" .` first.'
skill runs-tools "" '```bash
node tools/cortex-preflight.mjs
```'
skill runs-mcp "" 'Then `node mcp/ai-os.js inbox`.'
skill runs-bash "" 'Then bash tools/cortex-init.sh.'
skill typed-only "disable-model-invocation: true
" 'Once only.'
skill dead-link "" 'See [nothing](MISSING.md).'
skill binary "" 'Look at the picture.'
printf 'PNG' > "$F/skills/binary/shot.png"
skill wrong-name "" 'Body.'
sed 's/^name: wrong-name$/name: another-name/' "$F/skills/wrong-name/SKILL.md" > "$F/x" && mv "$F/x" "$F/skills/wrong-name/SKILL.md"

judged="$(node --input-type=module -e '
  import { join } from "node:path";
  import { pathToFileURL } from "node:url";
  const [lib, root] = process.argv.slice(1);
  const { judgeSkill } = await import(pathToFileURL(lib).href);
  const release = { version: "1.2.3", repository: "https://github.com/example-org/cortex" };
  for (const n of ["clean", "plugin-root", "runs-tools", "runs-mcp", "runs-bash", "typed-only", "dead-link", "binary", "wrong-name", "absent"]) {
    const j = judgeSkill(n, { root, release });
    console.log(`${n}=${j.portable ? "portable" : "no"}:${j.reasons.join(" | ")}`);
    if (n === "clean") for (const f of j.files) console.log(`FILE ${f.rel}\n${f.text}`);
  }
' "$LIB" "$F" 2>&1)"
line() { printf '%s\n' "$judged" | grep "^$1=" ; }
assert_contains "$(line clean)" "clean=portable:" "a skill with no Claude Code dependency is portable"
assert_contains "$judged" "(https://github.com/example-org/cortex/blob/v1.2.3/docs/adr.md)" "its link out of the folder names the file on the release"
assert_contains "$judged" "[the format](FORMAT.md)" "its link inside the folder is left alone"
assert_not_contains "$judged" "effort: low" "its Claude Code frontmatter key is dropped"
assert_contains "$judged" "  capability: judgment" "and its metadata kept"
assert_contains "$(line plugin-root)" "a variable only Claude Code sets (CLAUDE_PLUGIN_ROOT)" "\${CLAUDE_PLUGIN_ROOT} is not portable"
assert_contains "$(line plugin-root)" "runs a Cortex script" "nor is running index/ through it"
assert_contains "$(line runs-tools)" "runs a Cortex script (node tools/cortex-preflight.mjs)" "nor is node tools/, inside a code fence too"
assert_contains "$(line runs-mcp)" "runs a Cortex script (node mcp/ai-os.js)" "nor is node mcp/"
assert_contains "$(line runs-bash)" "runs a Cortex script (bash tools/cortex-init.sh)" "nor is bash tools/"
assert_contains "$(line typed-only)" "disable-model-invocation" "nor a skill that relies on Claude Code to keep it from starting itself"
assert_contains "$(line dead-link)" "links to MISSING.md, which is not there" "nor a dead link"
assert_contains "$(line binary)" "ships shot.png" "nor a file the check cannot read"
assert_contains "$(line wrong-name)" "its name must be the folder's" "nor a name that is not the folder's"
assert_contains "$(line absent)" "has no SKILL.md" "and a ritual with no SKILL.md is reported, not packed"

# A pack is published, so a credential stops the build before anything is written.
skill challenge-plan "" "The key is $(printf '%s%s' AKIA Q7X2M4N8P1R5T9V3)."
refused="$(node --input-type=module -e '
  import { pathToFileURL } from "node:url";
  const [lib, root] = process.argv.slice(1);
  const { buildPack } = await import(pathToFileURL(lib).href);
  try { buildPack("pm", { root, release: { version: "1.2.3", repository: "https://github.com/example-org/cortex" } }); console.log("built"); }
  catch (e) { console.log(e.message); }
' "$LIB" "$F" 2>&1)"
assert_contains "$refused" "holds what reads as a credential" "a pack whose skill holds a credential is refused"
assert_not_contains "$refused" "Q7X2M4N8P1R5T9V3" "and the refusal does not repeat it"
