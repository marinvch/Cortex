# cortex_root — which variable names the root, in the shell half (#552).
#
# The shell counterpart of rootFromEnv() in core/paths.js, and the same cases as
# core/test/root-from-env.test.js: CORTEX_ROOT is the name, AI_OS_ROOT is what an install made
# before it carries and is still read, CORTEX_ROOT wins when both are set, and an empty value is an
# unset one. A second reader that ordered the two names for itself would open a different brain
# from the same environment, so the rule lives in tools/_cortex-lib.sh and nowhere else.
#
# tools/server/cortex-cron.sh cannot source that lib: it is copied onto a server beside only
# server-setup.sh. It carries its own copy of the function, and the last block here is what stops
# the copy drifting, the arrangement date-parity.test.sh has for the clock.
#
# Every case sets or clears BOTH variables. A developer's shell may carry either one.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

LIB="$REPO_ROOT/tools/_cortex-lib.sh"
CRON="$REPO_ROOT/tools/server/cortex-cron.sh"

# root_run <CORTEX_ROOT|-> <AI_OS_ROOT|-> — run cortex_root in a clean shell. `-` leaves the
# variable unset; anything else, the empty string included, sets it. Sets $out, $err and $code.
root_run() {
  local new="$1" old="$2"
  local -a envargs=(-u CORTEX_ROOT -u AI_OS_ROOT)
  [ "$new" = "-" ] || envargs+=("CORTEX_ROOT=$new")
  [ "$old" = "-" ] || envargs+=("AI_OS_ROOT=$old")
  out="$(env "${envargs[@]}" bash -c '. "$1"; cortex_root' _ "$LIB" 2>"$WORK/root.err")"
  code=$?
  err="$(cat "$WORK/root.err")"
}

# --- one name ---

root_run /new -
assert_eq "0" "$code" "CORTEX_ROOT alone is a root"
assert_eq "/new" "$out" "and it is the one printed"
assert_eq "" "$err" "with nothing on stderr"

root_run - /old
assert_eq "0" "$code" "AI_OS_ROOT alone is still a root"
assert_eq "/old" "$out" "and it is the one printed"
assert_eq "" "$err" "with no warning: the old name is supported, not deprecated"

# --- both names ---

root_run /same /same
assert_eq "/same" "$out" "both set and equal: that root"
assert_eq "" "$err" "and nothing to report"

root_run /new /old
assert_eq "0" "$code" "both set and different still resolves"
assert_eq "/new" "$out" "CORTEX_ROOT wins"
assert_eq "1" "$(printf '%s\n' "$err" | grep -c .)" "and exactly one line says so"
case "$err" in
  "cortex: "*) _pass "that line starts with cortex:" ;;
  *) _fail "that line starts with cortex:" "actual: $err" ;;
esac
assert_contains "$err" "/old" "it names the root that was ignored"
assert_contains "$err" "AI_OS_ROOT" "and the variable it came from"
assert_contains "$err" "/new" "and the root that was used"

# The notice belongs on stderr. On stdout it would become part of the path a caller captures.
assert_not_contains "$out" "cortex:" "the notice is never mixed into the answer"

# --- neither, and the empty string ---

root_run - -
assert_eq "1" "$code" "neither set is a failure, never a guess"
assert_eq "" "$out" "and prints no path"

root_run "" ""
assert_eq "1" "$code" "two empty strings are unset"
assert_eq "" "$out" "and print no path"

root_run "" -
assert_eq "1" "$code" "an empty CORTEX_ROOT alone is unset"

root_run - ""
assert_eq "1" "$code" "an empty AI_OS_ROOT alone is unset"

root_run "   " -
assert_eq "1" "$code" "a blank CORTEX_ROOT is unset"

root_run "" /old
assert_eq "/old" "$out" "an empty CORTEX_ROOT falls back to AI_OS_ROOT instead of shadowing it"
assert_eq "" "$err" "without calling that a conflict"

root_run "  " /old
assert_eq "/old" "$out" "and so does a blank one"

root_run /new ""
assert_eq "/new" "$out" "an empty AI_OS_ROOT beside a set CORTEX_ROOT is not a conflict"
assert_eq "" "$err" "so nothing is reported"

root_run " /new " /new
assert_eq "/new" "$out" "surrounding whitespace is not part of the path"
assert_eq "" "$err" "and does not make two equal roots differ"

# A path with a space in it survives: only the ends are trimmed.
root_run "/my vault" -
assert_eq "/my vault" "$out" "a space inside the path is kept"

# --- under `set -u`, the mode the cron script runs in ---

out="$(env -u CORTEX_ROOT -u AI_OS_ROOT bash -c 'set -euo pipefail; . "$1"; cortex_root || echo none' _ "$LIB" 2>&1)"
assert_eq "none" "$out" "an unset variable is not an unbound-variable crash under set -u"

# --- the shell rule and the JS rule give one answer, over every pairing ---
#
# The cases above are the ones somebody thought of. This runs both implementations over the whole
# grid and compares them, so a change to one that the other did not get fails here whichever case
# it lands in. The values are bare words on purpose: Git Bash rewrites an environment value that
# looks like a POSIX path before a Windows node.exe sees it, and the two would then be compared on
# different inputs.
js_root() {
  local new="$1" old="$2"
  local -a envargs=(-u CORTEX_ROOT -u AI_OS_ROOT)
  [ "$new" = "-" ] || envargs+=("CORTEX_ROOT=$new")
  [ "$old" = "-" ] || envargs+=("AI_OS_ROOT=$old")
  ( cd "$REPO_ROOT" || exit 1
    env "${envargs[@]}" node -e 'import("./core/paths.js").then((m) => { const r = m.rootFromEnv(process.env); process.stdout.write((r.root ?? "<none>") + "|" + (r.ignored === null ? "quiet" : "said")); })' )
}
grid=0; disagree=""
for new in - "" " " alpha beta " alpha "; do
  for old in - "" " " alpha beta " alpha "; do
    root_run "$new" "$old"
    sh_answer="${out:-<none>}|$([ -z "$err" ] && echo quiet || echo said)"
    js_answer="$(js_root "$new" "$old")"
    grid=$((grid + 1))
    [ "$sh_answer" = "$js_answer" ] || disagree="$disagree [new='$new' old='$old' sh='$sh_answer' js='$js_answer']"
  done
done
assert_eq "36" "$grid" "all 36 pairings of the two variables were run"
assert_eq "" "$disagree" "cortex_root and rootFromEnv agree on every one"
# And the grid is not 36 copies of one answer: it holds a winner, a fallback, a notice and a refusal.
root_run alpha beta;  assert_eq "alpha|said" "${out:-<none>}|$([ -z "$err" ] && echo quiet || echo said)" "the grid includes a conflict"
assert_eq "alpha|said" "$(js_root alpha beta)" "which the JS half reports the same way"
assert_eq "<none>|quiet" "$(js_root - -)" "and a refusal"

# --- the cron script's copy is the lib's function, character for character ---

fn_of() { sed -n '/^cortex_root(){/,/^}/p' "$1"; }
LIB_FN="$(fn_of "$LIB")"
CRON_FN="$(fn_of "$CRON")"

# Guard the extractor. A sed that matched nothing would compare "" with "" and pass.
assert_contains "$LIB_FN" "CORTEX_ROOT" "the lib's cortex_root was extracted"
assert_contains "$LIB_FN" "AI_OS_ROOT" "and it still reads the older name"
if [ "$(printf '%s\n' "$LIB_FN" | wc -l | tr -d ' ')" -ge 5 ]; then
  _pass "and it is a whole function, not one line of it"
else
  _fail "and it is a whole function, not one line of it" "extracted: $LIB_FN"
fi
assert_eq "$LIB_FN" "$CRON_FN" "cortex-cron.sh carries the same cortex_root as the lib"

# --- nothing else in the shell half orders the two names for itself ---

# A tool that needs the root calls cortex_root. One that expands the variables itself is a second
# copy of the rule. cortex-init.sh mentions neither; the cron script's copy is pinned above.
readers=""
for f in "$REPO_ROOT"/tools/*.sh "$REPO_ROOT"/tools/server/*.sh; do
  case "$f" in "$LIB") continue ;; esac
  body="$(grep -v '^[[:space:]]*#' "$f")"
  [ "$f" = "$CRON" ] && body="$(printf '%s\n' "$body" | sed '/^cortex_root(){/,/^}/d')"
  if grep -qE '\$\{?(CORTEX_ROOT|AI_OS_ROOT)' <<<"$body"; then readers="$readers ${f#"$REPO_ROOT"/}"; fi
done
assert_eq "" "$readers" "no shell tool expands CORTEX_ROOT or AI_OS_ROOT outside cortex_root"
