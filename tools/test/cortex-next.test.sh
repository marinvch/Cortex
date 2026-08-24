# The sequence is a claim about someone's repo, and the CLI is where it becomes a sentence.
#
# index/test/next.test.mjs covers the state machine. This covers the thing a user actually runs, and
# the failure it prevents is not a crash: it is a confident wrong instruction. "Next → /cortex-scaffold"
# on a repo that still needs /optimize-context sends someone into a hand-merge; a ✓ on a step nobody
# ran sends them past the step that writes their context layer. Every assertion below defends a
# sentence, not a number — the same reason cortex-impact.mjs has a CLI test of its own.

NEXT="$REPO_ROOT/index/cortex-next.mjs"

INDEX_JSON='{"version":"1","files":[],"edges":[],"areas":[],"layers":[],"cycles":[],"stats":{}}'

# --- fixtures, built the way a user's repo actually arrives ---------------------------------------

fresh() { # fresh <name> — an empty git repo, nothing installed
  rm -rf "$WORK/$1"
  mkdir -p "$WORK/$1"
  ( cd "$WORK/$1" && git init -q . && git config user.email t@t && git config user.name t )
}

indexed() { # indexed <name> — index + findings present, nothing scaffolded
  fresh "$1"
  mkdir -p "$WORK/$1/.cortex/index" "$WORK/$1/.cortex/findings"
  printf '%s\n' "$INDEX_JSON" > "$WORK/$1/.cortex/index/index.json"
  printf '# report\n'         > "$WORK/$1/.cortex/findings/2026-01-01.md"
}

run() { node "$NEXT" "$WORK/$1" "${@:2}" 2>&1; }

# --- it writes nothing, and that has to be true of the CLI and not just the library ---------------

# A read-only tool that creates .cortex/ on a repo the user has not consented to is the whole
# product's central claim broken by a convenience. Assert the absence, not the intent.
fresh bare
run bare >/dev/null
assert_eq "absent" "$([ -e "$WORK/bare/.cortex" ] && echo present || echo absent)" \
  "running it on a bare repo creates no .cortex/"

# --- the entry point ------------------------------------------------------------------------------

out="$(run bare)"
assert_contains "$out" "Next → /cortex-install" "a bare repo is told the entry point, by name"
assert_contains "$out" "0 of" "and that nothing is done yet"
assert_not_contains "$out" "Next → /cortex-scaffold" "never a step that cannot run yet"

# --- a ✓ is a file on disk -------------------------------------------------------------------------

indexed mid
out="$(run mid)"
assert_contains "$out" ".cortex/index/index.json is present" "a done step cites the file that proves it"
assert_contains "$out" "2026-01-01.md" "and names the report it found, not just its existence"
assert_contains "$out" "Next → /cortex-scaffold" "the next unfinished required step is the answer"

# The optional graph step sits ABOVE scaffold in the list and is unfinished here. A sequence that
# let an optional step become "next" would stall the user on something that never had to happen.
assert_not_contains "$out" "Next → /cortex-view" "an optional step never becomes next"

# --- the step that must come first ----------------------------------------------------------------

# /optimize-context before /cortex-scaffold, not after. Scaffold is brownfield-safe and will not
# clobber a curated AGENTS.md, which is exactly why getting this order wrong is expensive: the user
# ends up with their file plus an AGENTS.generated.md and a merge to do by hand.
indexed brown
printf '# hand-written\n' > "$WORK/brown/CLAUDE.md"
out="$(run brown)"
assert_contains "$out" "Next → /optimize-context" "a repo with prior agent docs reconciles first"
assert_contains "$out" "CLAUDE.md" "and the doc is named, so the user can check the call"

# Written AFTER the index on purpose. An earlier version compared mtimes to decide who authored a
# doc; it passed on Windows, failed on Linux where both land in the same millisecond, and made this
# step vanish silently. The witness is CONTEXT.md, which no clock can race.
indexed late
printf '%s\n' "$INDEX_JSON" > "$WORK/late/.cortex/index/index.json"
printf '# hand-written, saved last\n' > "$WORK/late/CLAUDE.md"
out="$(run late)"
assert_contains "$out" "Next → /optimize-context" "write order does not decide who authored a doc"

# Once the scaffold has run, the same AGENTS.md is Cortex's own and reconciling it is noise.
indexed done
printf '# root\n' > "$WORK/done/AGENTS.md"
printf '# terms\n' > "$WORK/done/CONTEXT.md"
out="$(run done)"
assert_not_contains "$out" "/optimize-context" "CONTEXT.md settles it — no phantom reconcile step"
assert_contains "$out" "AGENTS.md + CONTEXT.md are in place" "and the scaffold step reads as done"

# --- what jumps the queue --------------------------------------------------------------------------

# /migrate-engine harvests the old memory store into AGENTS.md BEFORE deleting anything. A sequence
# that walked past it would lose that knowledge permanently, so it outranks every finished step.
indexed legacy
mkdir -p "$WORK/legacy/.ai-os"
printf '{}\n' > "$WORK/legacy/.ai-os/memory.json"
printf '# root\n'  > "$WORK/legacy/AGENTS.md"
printf '# terms\n' > "$WORK/legacy/CONTEXT.md"
out="$(run legacy)"
assert_contains "$out" "Next → /migrate-engine" "a retired engine outranks everything else"
assert_contains "$out" "do this first" "and says so where the user is looking"
assert_contains "$out" ".ai-os" "naming what it found, so the claim is checkable"

# --- the machine-readable halves --------------------------------------------------------------------

# --line is what other CLIs paste into their footer. More than one line and it stops being a footer.
out="$(run mid --line)"
assert_eq "1" "$(printf '%s\n' "$out" | grep -c .)" "--line prints exactly one line"
assert_contains "$out" "Next →" "and it is the next-step line"

out="$(run mid --json)"
assert_contains "$out" '"next"' "--json carries the next step"
assert_contains "$out" '"steps"' "and the whole ordered runbook"
printf '%s' "$out" > "$WORK/out.json"
assert_exit 0 "--json is valid JSON a ritual can walk" -- node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$WORK/out.json"

# --- the per-change rituals are a lookup, never a step ---------------------------------------------

# They are triggered by what the user is doing, not by how far along the install is. Promoting one
# into the sequence would tell someone to run /cortex-review before they have anything to review.
out="$(run mid)"
assert_contains "$out" "Per change" "the lookup is present"
assert_contains "$out" "/cortex-review" "and names the review ritual"
assert_not_contains "$out" "Next → /cortex-review" "but never as the next step"
