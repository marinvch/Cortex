# The findings report is /cortex-install's script, so its ranking is control flow, not presentation.
#
# index/test/findings.test.mjs covers analyse() and offers() as functions, and
# tools/test/install-on-a-project.test.sh already proves the pipeline runs on a repo shaped like
# product code and leaves it untouched under `--out`. Neither reaches the two things below, and both
# are things the CLI *says* rather than things it returns:
#
#   1. **Severity is decided by churn**, and churn needs a git history. Every other fixture in this
#      suite is one commit, so `commits > 5` — the branch that promotes "modules appear untested"
#      from medium to high, and therefore moves it up the interview — has never been executed by a
#      test. Neither has the Hot spots finding, whose whole content is commit counts.
#   2. **The greenfield branch**, where ranking absent documentation as a defect would be nonsense.
#      A repo with no code must get a different report AND a different closing instruction; pointing
#      it at "the areas listed above" names areas that do not exist.

FINDINGS="$REPO_ROOT/index/cortex-findings.mjs"
INDEX="$REPO_ROOT/index/cortex-index.mjs"

PROJ="$WORK/proj"
run() { node "$FINDINGS" "$PROJ" "$@" 2>&1; }

# --- a repo with a history, because severity is computed from one ---------------------------------

# Three untested modules in one directory is the threshold for the finding to exist at all; more
# than five commits on them is the threshold that ranks it high. Both are crossed deliberately, so
# a change to either number fails here with the reason visible.
rm -rf "$PROJ"; mkdir -p "$PROJ/src" "$PROJ/test"
cd "$PROJ" || exit 1
git init -q .; git config user.email t@t; git config user.name t
printf '{ "name": "p", "version": "1.0.0" }\n' > package.json
printf 'export const cold = 1;\n'  > src/cold.js
printf 'export const warm = 1;\n'  > src/warm.js
printf 'export const hot = 1;\n'   > src/hot.js
printf 'export const seen = 1;\n'  > src/seen.js
printf 'import { seen } from "../src/seen.js";\nif (!seen) throw new Error("x");\n' > test/seen.test.js
git add -A && git commit -qm init
i=0
while [ "$i" -lt 7 ]; do
  printf 'export const hot = %s;\n' "$i" > src/hot.js
  git add -A && git commit -qm "churn $i"
  i=$((i + 1))
done
cd "$WORK" || exit 1
node "$INDEX" "$PROJ" >/dev/null 2>&1

out="$(run --stdout)"

assert_contains "$out" "modules appear untested" "the untested finding fires"

# Read the finding's own evidence block, not the whole report. src/seen.js legitimately appears
# under Hot spots — that section lists churn regardless of coverage — and a whole-report match would
# pass or fail for reasons that have nothing to do with what is being asserted.
untested_block="$(printf '%s' "$out" | sed -n '/^#### .*modules appear untested/,/^#### /p')"
assert_contains "$untested_block" "src/hot.js" "and names the module a reader can go and look at"
# Coverage uses three signals, and test/seen.test.js reaches src/seen.js by both name and import.
# Calling it untested would be the false positive that teaches people to skip the section.
assert_not_contains "$untested_block" "src/seen.js" "a module a test actually exercises is not called untested"

assert_contains "$out" "Hot spots" "churn is reported, because improvement work pays off there first"
assert_contains "$out" "src/hot.js — 8 commits" "with the real count from git, not an estimate"

# Severity is control flow (ADR 0006), so where a finding lands decides which question the wizard
# asks first. High is the branch that only a real history can reach.
high_block="$(printf '%s' "$out" | sed -n '/^### High/,/^### Medium/p')"
assert_contains "$high_block" "modules appear untested" "a hot, untested area is ranked High, not Medium"

# --- the worklist the wizard actually walks -------------------------------------------------------

offers="$(run --offers)"
assert_contains "$offers" '"action"' "--offers is the machine surface and names an action per entry"
[ -d "$PROJ/.cortex/findings" ] && _fail "--offers writes no report" || _pass "--offers writes no report"

# Collapsing by action is the point: five areas that each want a brief are ONE decision naming five
# candidates, not five questions. A repo with no AGENTS.md, no CONTEXT.md and no ADRs raises three
# separate findings and must still be asked once.
scaffolds="$(printf '%s' "$offers" | grep -c '"action": "scaffold"')"
assert_eq "1" "$scaffolds" "three missing context documents collapse into one scaffold question"
assert_contains "$offers" "No CONTEXT.md glossary" "and the entry carries the titles, so it can say why it is asking"

# --- writing the report ---------------------------------------------------------------------------

out="$(run)"
assert_contains "$out" "findings" "the default run says how many it found"
assert_contains "$out" "Next →" "and hands the reader the next command, because a report is not an action"
written="$(ls "$PROJ/.cortex/findings" | wc -l | tr -d ' ')"
assert_eq "1" "$written" "exactly one dated report per run, never a growing pile"
run >/dev/null
assert_eq "1" "$(ls "$PROJ/.cortex/findings" | wc -l | tr -d ' ')" "and a second run the same day overwrites rather than accumulates"

# --stdout is the read-only surface. It existed before --offers and is still what a human pipes.
rm -rf "$PROJ/.cortex/findings"
run --stdout >/dev/null
[ -d "$PROJ/.cortex/findings" ] && _fail "--stdout writes no file" || _pass "--stdout writes no file"

# --- greenfield: the other install flow ------------------------------------------------------------

# "No AGENTS.md" is only high-leverage when there is code to explain, and "domain terms drift" needs
# a domain. A repo with nothing in it must be told that scaffolding is the whole job, and must not be
# handed a list of defects it cannot have.
PROJ="$WORK/green"
mkrepo "$PROJ"
node "$INDEX" "$PROJ" >/dev/null 2>&1
out="$(run --stdout)"

assert_contains "$out" "Greenfield repo" "an empty repo is named as the greenfield flow, not audited"
assert_contains "$out" "scaffolding is the whole job" "and the closing instruction matches the flow"
assert_not_contains "$out" "the areas listed above" "never pointing at areas that do not exist"
assert_not_contains "$out" "No agent context file" "and missing docs are not defects where there is no code"
