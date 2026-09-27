# The placeholder check has to be right in BOTH directions, and the old one was wrong in one.
#
# `/cortex-scaffold` used to say "grep for `{{` and fix what you find". On a real install that grep
# had three hits and all three were correct files: `docs/adr/TEMPLATE.md` and `intent/TEMPLATE.md`
# keep their placeholders on purpose, and `agent-evals.yml` keeps GitHub's `${{ … }}`. A check that
# cries wolf on every run is skipped on the run that matters. So this pins zero false hits on a
# correctly stamped set, and a named hit for every template placeholder actually left behind.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

PH="$REPO_ROOT/tools/cortex-placeholders.mjs"
T="$REPO_ROOT/templates"

# --- a stamp that forgot to fill anything: every template placeholder is named ---------------------
raw="$WORK/raw"
mkdir -p "$raw/.claude/agents" "$raw/intent" "$raw/.github/workflows"
cp "$T/target-AGENTS.md" "$raw/AGENTS.md"
cp "$T/loop/verification.md" "$raw/CLAUDE.md"
cp "$T/loop/REVIEW.md" "$raw/REVIEW.md"
cp "$T/loop/verifier.md" "$raw/.claude/agents/verifier.md"
cp "$T/loop/intent-README.md" "$raw/intent/README.md"
cp "$T/loop/agent-evals.yml" "$raw/.github/workflows/agent-evals.yml"

out="$(cd "$raw" || exit 1; node "$PH" AGENTS.md CLAUDE.md REVIEW.md .claude intent .github 2>&1)"
assert_exit 1 "a raw template copy fails the check" -- env -C "$raw" node "$PH" AGENTS.md
assert_contains "$out" "unfilled     AGENTS.md:" "AGENTS.md's placeholders are named with a line number"
assert_contains "$out" "{{project name}}" "including the project name"
assert_contains "$out" "REVIEW.md:" "REVIEW.md's cap and exclusions are caught"
assert_contains "$out" "{{NIT_CAP}}" "by name"
assert_contains "$out" ".claude/agents/verifier.md:" "the verifier's run command is caught"
assert_contains "$out" "{{TEST_CMD}}" "the evals workflow's test command is caught"
assert_not_contains "$out" "github.ref" "a GitHub Actions \${{ }} expression is never a hit"
assert_not_contains "$out" "secrets.ANTHROPIC" "not even one sharing a line with a real placeholder"

# --- a correct stamp: zero hits, TEMPLATE.md kept, Actions syntax and a Vue repo's braces ignored ------
ok="$WORK/ok"
mkdir -p "$ok/docs/adr" "$ok/intent" "$ok/.github/workflows" "$ok/adr"
printf '# acme — agent brief\n\nRender `{{ msg }}` in a Vue template; `{{test}}` is our fixture name.\n' > "$ok/AGENTS.md"
printf '@AGENTS.md\n\n## Verifying your work\n\n| Test | `npm test` |\n' > "$ok/CLAUDE.md"
cp "$T/adr.md" "$ok/docs/adr/TEMPLATE.md"
cp "$T/adr.md" "$ok/adr/TEMPLATE.md"
cp "$T/loop/intent.md" "$ok/intent/TEMPLATE.md"
sed -e 's/{{TEST_CMD}}/npm test/' -e '/{{SETUP_STEPS}}/d' "$T/loop/agent-evals.yml" > "$ok/.github/workflows/agent-evals.yml"

assert_exit 0 "a correctly stamped set passes" \
  -- env -C "$ok" node "$PH" AGENTS.md CLAUDE.md docs/adr adr intent .github
out="$(cd "$ok" || exit 1; node "$PH" AGENTS.md CLAUDE.md docs/adr adr intent .github 2>&1)"
assert_not_contains "$out" "unfilled" "zero false hits: TEMPLATE.md, \${{ }} and a repo's own {{ }} are all clean"
assert_contains "$out" "kept         docs/adr/TEMPLATE.md" "an ADR template is reported as kept on purpose"
assert_contains "$out" "kept         intent/TEMPLATE.md" "and so is the intent template"

# --- a multi-line placeholder a formatter reflowed is still caught ------------------------------------
reflow="$WORK/reflow"
mkdir -p "$reflow"
printf '# x\n\n{{One or two sentences: what this codebase does and who it serves.\nNot the stack — the purpose.}}\n' > "$reflow/AGENTS.md"
assert_exit 1 "a placeholder reflowed across lines is still a placeholder" \
  -- env -C "$reflow" node "$PH" AGENTS.md

# --- a file that was never written is a failure, not a pass ------------------------------------------
assert_exit 1 "a named file that does not exist fails — it was never written" \
  -- env -C "$ok" node "$PH" GEMINI.md
assert_exit 2 "no files named is a usage error, not a clean bill" -- env -C "$ok" node "$PH"
