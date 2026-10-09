# Two developers who each write memory on one day, on two branches, merge with no conflict.
#
# This is the reproduction in docs/specs/2026-10-09-team-memory-design.md made permanent (plan step
# 4.2). The writer is the real CLI, the repo is a real git repo, and the merge is git's own: the
# claim is about what git does with the files the writer made, so nothing here is a stand-in.
#
# The same steps run four times:
#
#   dev-a and dev-b, by CORTEX_AUTHOR    two files, the merge is clean
#   dev-a and dev-a                      one file written on both branches, the merge FAILS
#   two git user.names, no CORTEX_AUTHOR two files, the merge is clean
#   no name at all                       the day file on both branches, the merge FAILS, as before 4.2
#
# The second case is what shows the first can go red. A test of "the merge is clean" that had never
# seen a conflict would pass just as well on a writer that wrote nothing.
#
# No identity is read from the machine. Git is given an empty global and system config and a ceiling
# at $WORK, and every name a commit or the writer needs is set in the fixture.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

MEMORY="$REPO_ROOT/index/cortex-memory.mjs"

: > "$WORK/empty.gitconfig"
# git and the writer, with nothing of the machine's in reach.
clean() {
  env -u CORTEX_AUTHOR -u GIT_DIR -u GIT_WORK_TREE -u GIT_AUTHOR_NAME -u GIT_COMMITTER_NAME \
    GIT_CONFIG_GLOBAL="$WORK/empty.gitconfig" GIT_CONFIG_SYSTEM="$WORK/empty.gitconfig" \
    GIT_CONFIG_NOSYSTEM=1 GIT_CEILING_DIRECTORIES="$WORK" "$@"
}
# Commits name their own committer, so the repo's user.name stays free to be what a case is about.
g() { # g <repo> <git args...>
  local w="$1"
  shift
  clean git -C "$w" -c user.name=fixture -c user.email=fixture@example.invalid -c core.autocrlf=false "$@"
}

# base <name> — a repo with one commit on main. `.cortex/` is committed, holding a file that is not
# memory, because git keeps no empty directory and the writer never creates `.cortex/`.
base() {
  local w="$WORK/$1"
  mkdir -p "$w/.cortex"
  clean git -C "$w" init -q -b main
  printf '# fixture\n' > "$w/README.md"
  printf 'kept so the directory exists on every branch\n' > "$w/.cortex/keep"
  g "$w" add -A
  g "$w" commit -q -m base
}

# write <name> <branch> <text> [VAR=value ...] — cut <branch> from main, append one entry with the
# real CLI under the given environment, and commit whatever it wrote.
write() {
  local w="$WORK/$1" branch="$2" text="$3"
  shift 3
  g "$w" checkout -q -b "$branch" main
  wrote="$(clean env "$@" node "$MEMORY" append "$text" --kind dream --root "$w/.cortex" 2>"$WORK/write.err")"
  write_code=$?
  write_err="$(cat "$WORK/write.err")"
  g "$w" add -A
  g "$w" commit -q -m "$branch dreams"
}

# merge_both <name> — merge a, then b, into main. Sets $merge_code to the exit of the second merge.
merge_both() {
  local w="$WORK/$1"
  g "$w" checkout -q main
  g "$w" merge -q --no-edit a >/dev/null 2>&1
  g "$w" merge --no-edit b >"$WORK/merge.out" 2>&1
  merge_code=$?
  merge_out="$(cat "$WORK/merge.out")"
  tracked="$(g "$w" ls-files .cortex/memory | sed 's#[0-9]\{4\}-[0-9][0-9]-[0-9][0-9]#DAY#' | tr '\n' ' ')"
  unmerged="$(g "$w" diff --name-only --diff-filter=U | sed 's#[0-9]\{4\}-[0-9][0-9]-[0-9][0-9]#DAY#' | tr '\n' ' ')"
}

# --- dev-a and dev-b: two files, a clean merge -----------------------------------------------------

base two
write two a "authoralpha: chose the queue over the cron job." CORTEX_AUTHOR=dev-a
assert_eq "0" "$write_code" "dev-a's write succeeds"
assert_eq "" "$write_err" "and says nothing on stderr: it named its author"
write two b "authorbravo: the parser drops a trailing comma." CORTEX_AUTHOR=dev-b
assert_eq "0" "$write_code" "dev-b's write succeeds"
merge_both two
assert_eq "0" "$merge_code" "two authors on two branches merge with no conflict"
assert_eq "" "$unmerged" "and no path is left unmerged"
assert_eq ".cortex/memory/DAY/dev-a.md .cortex/memory/DAY/dev-b.md " "$tracked" "both files exist after the merge"
assert_not_contains "$merge_out" "CONFLICT" "git reported no conflict"
all="$(cat "$WORK"/two/.cortex/memory/*/dev-a.md "$WORK"/two/.cortex/memory/*/dev-b.md)"
assert_contains "$all" "authoralpha: chose the queue over the cron job." "dev-a's entry is in the merged tree"
assert_contains "$all" "authorbravo: the parser drops a trailing comma." "dev-b's entry is in the merged tree"
assert_not_contains "$all" "<<<<<<<" "and neither file carries a conflict marker"
# The readers read what was merged: the real reader, on the real merge result.
recent="$(clean node "$MEMORY" recent --days 1 --root "$WORK/two/.cortex")"
assert_contains "$recent" "· dev-a" "recent prints dev-a's file, by its header"
assert_contains "$recent" "authorbravo: the parser drops a trailing comma." "and dev-b's entry"

# --- dev-a and dev-a: one path on both branches, and the merge fails --------------------------------

# The control. If this merged cleanly the case above would prove nothing about the layout: it would
# pass for any two writes at all.
base same
write same a "authoralpha: chose the queue over the cron job." CORTEX_AUTHOR=dev-a
write same b "authoralpha again, from a second machine." CORTEX_AUTHOR=dev-a
merge_both same
assert_eq "1" "$merge_code" "the same author on two branches does NOT merge cleanly"
assert_contains "$merge_out" "CONFLICT" "git reports the conflict"
assert_eq ".cortex/memory/DAY/dev-a.md " "$unmerged" "and it is in that one author's file"

# --- the author from git user.name, with no CORTEX_AUTHOR -------------------------------------------

# The default a team gets with no setup: each clone's own git name. Set in the repo's config before
# each write, which is what two clones with two identities amount to.
base bygit
clean git -C "$WORK/bygit" config user.name "Dev A"
write bygit a "authoralpha: chose the queue over the cron job."
assert_eq "" "$write_err" "a git name is an author, with nothing on stderr"
clean git -C "$WORK/bygit" config user.name "Dev B."
write bygit b "authorbravo: the parser drops a trailing comma."
merge_both bygit
assert_eq "0" "$merge_code" "two git identities merge with no conflict, with nothing set"
assert_eq ".cortex/memory/DAY/dev-a.md .cortex/memory/DAY/dev-b.md " "$tracked" "each wrote the file of its own slug"

# --- no name at all: the day file, the conflict, and the line that says so --------------------------

# What the fallback costs, pinned so nobody reads it as free: with no name the writer keeps the old
# layout, and the old layout conflicts exactly as the spec's reproduction did.
base nobody
write nobody a "first branch, no name."
assert_eq "0" "$write_code" "a write with no name still succeeds"
assert_contains "$write_err" "Set CORTEX_AUTHOR to " "and stderr names the setting that fixes it"
assert_contains "$write_err" "shared day file" "and says where the entry went"
write nobody b "second branch, no name."
assert_contains "$write_err" "Set CORTEX_AUTHOR to " "the second write says so too"
merge_both nobody
assert_eq "1" "$merge_code" "two writers with no name conflict, as every writer did before"
assert_eq ".cortex/memory/DAY.md " "$unmerged" "in the day file"
