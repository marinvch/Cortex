# The viewer writes a file into someone's repo, so where it writes matters as much as what it draws.
#
# index/test/view.test.mjs covers the data shape and the markup. This covers the thing a user runs.
# Two failures it prevents, neither of which is a crash: writing outside .cortex/ (nothing in index/
# may modify a target repository, which is what makes "the user decides" structural rather than a
# promise), and emitting a page that quietly needs the network — an offline artefact that fetches is
# worse than no artefact, because it looks fine on the machine that made it.

VIEW="$REPO_ROOT/index/cortex-view.mjs"

fixture() { # a small real repo, indexed the way a user would index it
  rm -rf "$WORK/proj"
  mkdir -p "$WORK/proj/src" "$WORK/proj/test"
  cd "$WORK/proj"
  git init -q .
  git config user.email t@t; git config user.name t

  printf 'export const q = 1;\n'                                  > src/db.js
  printf 'import { q } from "./db.js";\nexport const user = q;\n' > src/user.js
  printf 'import { user } from "../src/user.js";\n'               > test/user.test.js

  # A REAL import cycle. The viewer read index.cycles as a list of cycles when it is a flat list of
  # paths, so `c.map` threw and blanked every tab — and neither this fixture nor ai-os itself had a
  # cycle, so nothing executed that branch until the tool met somebody else's repo.
  printf 'import { b } from "./b.js";\nexport const a = b;\n'     > src/a.js
  printf 'import { a } from "./a.js";\nexport const b = a;\n'     > src/b.js
  printf '# readme\n'                                             > README.md
  printf '{ "name": "p", "version": "1.0.0" }\n'                  > package.json

  git add -A && git commit -qm init
  node "$REPO_ROOT/index/cortex-index.mjs" . >/dev/null 2>&1
  cd "$REPO_ROOT"
}

run() { node "$VIEW" "$WORK/proj" --no-open "$@" 2>&1; }

# --- it refuses rather than guesses ----------------------------------------------------------------

# No index means no data. Inventing an empty page here is the failure the vault's viewer actually
# shipped: pointed at a codebase it found nothing and cheerfully wrote a graph with zero nodes.
rm -rf "$WORK/proj"; mkdir -p "$WORK/proj"
out="$(run || true)"
assert_contains "$out" "no index at" "without an index it says so"
assert_contains "$out" "cortex-index.mjs" "and names the command that fixes it"
assert_exit 2 "and exits non-zero rather than writing an empty page" -- node "$VIEW" "$WORK/proj" --no-open

# --- where it is allowed to write --------------------------------------------------------------------

fixture
before="$(cd "$WORK/proj" && git status --porcelain=v1 | sort)"
out="$(run)"
after="$(cd "$WORK/proj" && git status --porcelain=v1 | sort)"

assert_eq "present" "$([ -f "$WORK/proj/.cortex/view/repo.html" ] && echo present || echo absent)" \
  "it writes the page under .cortex/"
assert_eq "$before" "$after" "and changes nothing else git can see — no source file is touched"
assert_contains "$out" ".cortex" "the path it wrote is reported"

# The tracked source must be byte-identical afterwards. `git status` alone would miss an in-place
# rewrite that happened to restore the same size.
assert_exit 0 "tracked files are untouched" -- git -C "$WORK/proj" diff --quiet HEAD

# --- the page has to work with the network unplugged -------------------------------------------------

html="$WORK/proj/.cortex/view/repo.html"
page="$(cat "$html")"
assert_not_contains "$page" 'src="http' "no remote script"
assert_not_contains "$page" 'src="//' "not even a protocol-relative one"
assert_contains "$page" "<!doctype html>" "it is a whole document, not a fragment"
assert_contains "$page" "const DATA=" "with its data inlined"

# --- determinism, the same promise the index makes ---------------------------------------------------

# Same index, same bytes. A page that differs run to run cannot be diffed, and a reviewer cannot tell
# a real change from noise.
cp "$html" "$WORK/first.html"
run >/dev/null
assert_exit 0 "two runs of the same index produce identical bytes" -- cmp -s "$WORK/first.html" "$html"

# --- it tells the user where they are ------------------------------------------------------------------

out="$(run)"
assert_contains "$out" "Next →" "it ends with the next step, like the other CLIs"
assert_contains "$out" "orphans" "and summarises the gaps it found"

# --- a repo with a cycle renders instead of blanking -------------------------------------------------

# The fixture's src/a.js and src/b.js import each other. The count is FILES in cycles, which is what
# cortex-index prints for the same repo; calling two files two cycles makes the two tools disagree.
assert_contains "$out" "2 in cycles" "files in cycles are counted, and named as files"
assert_not_contains "$out" "2 cycles" "never restated as a cycle count"

page="$(cat "$WORK/proj/.cortex/view/repo.html")"
assert_contains "$page" "src/a.js" "and the cyclic files reach the page"
assert_contains "$page" "Files in import cycles" "under a heading that says what the list holds"

# --- --json is the read-only door ------------------------------------------------------------------------

rm -rf "$WORK/proj/.cortex/view"
out="$(node "$VIEW" "$WORK/proj" --json 2>&1)"
assert_eq "absent" "$([ -e "$WORK/proj/.cortex/view" ] && echo present || echo absent)" \
  "--json writes no page"
printf '%s' "$out" > "$WORK/view.json"
assert_exit 0 "and emits JSON another tool can render" -- node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$WORK/view.json"

# --- what the map deliberately leaves out ------------------------------------------------------------------

# Markdown has no imports to draw. Keeping it out of the graph is a decision, not an omission, so it
# is asserted rather than left to whoever next reads the picture and assumes a bug.
assert_exit 0 "docs are present as files but excluded from the map" -- node -e '
  const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const readme = v.nodes.find(n => n.id === "README.md");
  if (!readme) throw new Error("README.md missing from the file list");
  if (readme.inMap) throw new Error("README.md should not be drawn on the map");
  if (!v.nodes.some(n => n.id === "src/db.js" && n.inMap)) throw new Error("code must be drawn");
' "$WORK/view.json"

cd "$REPO_ROOT"

# --- a root that is not a directory ------------------------------------------------------------
#
# The check has no error state without it: buildIndex on a directory that does not exist returns
# zero files rather than throwing, so this command answered confidently about a repository that
# was never there — and two of its siblings wrote into one they invented from a mangled flag.
# index/test/root.test.mjs covers the predicate; this covers that THIS command consults it.

mkdir -p "$WORK/guard" && printf 'x
' > "$WORK/a-file"
out="$(cd "$WORK/guard" && node "${VIEW}" "$WORK/no-such-repo" 2>&1)"; rc=$?
assert_eq "1" "$rc" "a root that does not exist is refused"
assert_contains "$out" "not a directory" "and says what is wrong with it"
assert_contains "$out" "Nothing was changed" "and that nothing happened"
[ -n "$(ls -A "$WORK/guard" 2>/dev/null)" ] && _fail "and nothing is created anywhere" || _pass "and nothing is created anywhere"

# existsSync would pass a file. Walking one as though it were a repository is the same bug.
out="$(node "${VIEW}" "$WORK/a-file" 2>&1)"; rc=$?
assert_eq "1" "$rc" "a file passed as a root is refused too"
