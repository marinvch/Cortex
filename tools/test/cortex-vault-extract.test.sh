# tools/cortex-vault-extract.sh — the last untested destructive tool.
#
# It moves the personal layer out of the repo. That layer is gitignored, so it exists only in the
# working tree: a bad delete here has no history to restore from. The script knows this — it is
# dry-run by default, --apply copies, --remove-source is a separate opt-in, and a verification runs
# before anything is deleted. These tests pin that machinery, and the verification hardest of all.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

EX="$REPO_ROOT/tools/cortex-vault-extract.sh"

mkvault() { # dir [n-notes]
  local v="$1" n="${2:-2}" i
  mkdir -p "$v/tools" "$v/notes" "$v/context"
  cp "$EX" "$v/tools/"
  printf '# repo\n' > "$v/AGENTS.md"
  for i in $(seq 1 "$n"); do printf 'note %s\n' "$i" > "$v/notes/n$i.md"; done
  printf 'about me\n' > "$v/context/about.md"
  # Placeholders that must survive --remove-source.
  : > "$v/notes/.gitkeep"
  printf 'readme\n' > "$v/notes/README.md"
}
run_ex() { ( cd "$1" && shift && bash tools/cortex-vault-extract.sh "$@" 2>&1 ); }

# --- the default is a dry run ---

V="$WORK/ex-dry"; mkvault "$V"
D="$WORK/ex-dry-dest"
out="$(run_ex "$V" --to "$D")"
assert_contains "$out" "DRY RUN" "the default is a dry run, and says so"
assert_contains "$out" "files would move" "and reports what it would do"
assert_exit 1 "it writes nothing at all" -- test -d "$D"
assert_exit 0 "and leaves the source untouched" -- test -f "$V/notes/n1.md"

# --- guards ---

assert_exit 1 "--to is required" -- bash -c "cd '$V' && bash tools/cortex-vault-extract.sh"
out="$(run_ex "$V" --to "$D" 2>&1 || true)"

NOTREPO="$WORK/ex-notrepo"; mkdir -p "$NOTREPO/tools"; cp "$EX" "$NOTREPO/tools/"
out="$(run_ex "$NOTREPO" --to "$WORK/whatever" 2>&1 || true)"
assert_contains "$out" "Cortex repo" "it refuses to run outside the Cortex repo"

EMPTY="$WORK/ex-empty"; mkdir -p "$EMPTY/tools"; cp "$EX" "$EMPTY/tools/"; printf '# repo\n' > "$EMPTY/AGENTS.md"
out="$(run_ex "$EMPTY" --to "$WORK/ex-empty-dest")"
assert_contains "$out" "Nothing to extract" "an empty vault says so"
assert_exit 0 "and exits 0 — nothing to do is success" -- \
  bash -c "cd '$EMPTY' && bash tools/cortex-vault-extract.sh --to '$WORK/ex-empty-dest'"

# --- --apply copies and leaves the source ---

V="$WORK/ex-apply"; mkvault "$V"
D="$WORK/ex-apply-dest"
out="$(run_ex "$V" --to "$D" --apply --no-git)"
assert_exit 0 "--apply copies notes" -- test -f "$D/notes/n1.md"
assert_exit 0 "and other personal dirs" -- test -f "$D/context/about.md"
assert_exit 0 "the source is left in place" -- test -f "$V/notes/n1.md"
assert_contains "$out" "Source left in place" "and it says so"
assert_exit 1 "--no-git skips the git init" -- test -d "$D/.git"

# --- the verification: it must count THIS RUN's copy ---
#
# The bug: `copied` counted every file already in the destination. A destination that is not empty
# inflates it, so a partial copy can still clear the check — and the layer then deleted is
# gitignored, existing only in the working tree. Re-running into a non-empty destination is exactly
# what someone does after a first attempt goes wrong.

V="$WORK/ex-count"; mkvault "$V" 2      # 2 notes + README + about = 4 real files
D="$WORK/ex-count-dest"
mkdir -p "$D/unrelated"
for i in 1 2 3 4 5 6 7 8; do printf 'x\n' > "$D/unrelated/f$i.md"; done
out="$(run_ex "$V" --to "$D" --apply --no-git)"
reported="$(printf '%s\n' "$out" | sed -n 's/^copied \([0-9]*\) files.*/\1/p' | tail -1)"
planned="$(printf '%s\n' "$out" | sed -n 's/^\([0-9]*\) files would move.*/\1/p' | tail -1)"
assert_eq "$planned" "$reported" "the count reports what THIS run copied, not the destination's contents"

# --- a copy that does not fully land must never lead to a delete ---
#
# Deleting a file from the destination and re-running proves nothing: --apply re-copies, so the gap
# heals before the check. The honest simulation is a copy that FAILS — here by parking a directory
# where a file needs to be written, which is what a permissions problem, a full disk or an
# interrupted run looks like to `cp`.
#
# Either outcome is acceptable, and the assertion is deliberately about the source rather than the
# message: the script may refuse at the verification, or abort at the failing copy. What must never
# happen is reaching the delete.

V="$WORK/ex-short"; mkvault "$V" 3
D="$WORK/ex-short-dest"
mkdir -p "$D/notes/n2.md"                     # a directory where a file must go — cp cannot win
printf 'blocker\n' > "$D/notes/n2.md/blocker"
out="$(run_ex "$V" --to "$D" --apply --no-git --remove-source 2>&1 || true)"
assert_exit 0 "a copy that fails never reaches the delete — n1 survives" -- test -f "$V/notes/n1.md"
assert_exit 0 "nor n3" -- test -f "$V/notes/n3.md"
assert_exit 0 "and the other personal dirs survive too" -- test -f "$V/context/about.md"

# Coverage gap, stated rather than implied: the per-path `short` refusal inside the script is NOT
# reached by this test. A failing `cp` aborts under `set -e` before the verification runs, and a
# `cp` that returns 0 while silently dropping files cannot be provoked portably (the realistic
# case — a case-insensitive destination collapsing Foo.md and foo.md — does not reproduce on the
# Linux runner). What IS tested is the count it depends on, which was the actual bug. The refusal
# is belt-and-braces on top, and is deliberately kept for the error message it gives.

# --- --remove-source on a good copy keeps the placeholders ---

V="$WORK/ex-remove"; mkvault "$V" 2
D="$WORK/ex-remove-dest"
run_ex "$V" --to "$D" --apply --no-git --remove-source >/dev/null
assert_exit 1 "--remove-source clears the notes" -- test -f "$V/notes/n1.md"
assert_exit 0 "but keeps .gitkeep, so the repo structure still reads" -- test -f "$V/notes/.gitkeep"
assert_exit 0 "and keeps README.md" -- test -f "$V/notes/README.md"
assert_exit 0 "and the copy is safe at the destination" -- test -f "$D/notes/n1.md"
