# The wall clock is taken in one place — except for two scripts that cannot reach it.
#
# tools/cortex-init.sh is a zero-dependency installer and deliberately does not source
# _cortex-lib.sh; tools/server/cortex-cron.sh is copied onto a server beside only server-setup.sh,
# where there is no lib to source. Both therefore keep their own `date` call, and this file is what
# stops those copies drifting from the lib — the same arrangement slugify() already has in
# mcp/test/slug-parity.test.js.
#
# The comparison is on the FORMAT STRING, not on two live `date` runs: those tick between calls and
# would make the suite flaky at midnight for no extra confidence. `%F` and `%Y-%m-%d` are the same
# format written two ways, so the check normalises that equivalence rather than pretending the
# strings must match character for character.

LIB="$REPO_ROOT/tools/_cortex-lib.sh"
# shellcheck disable=SC1090
. "$LIB"

# fmt_of <file> <variable-name> — the `date +FMT` a given assignment uses, with %F normalised.
fmt_of() {
  sed -n "s/^[[:space:]]*$2=\"\$(\(date [^)\"]*\)).*/\1/p" "$1" \
    | head -1 | sed 's/%F/%Y-%m-%d/'
}
# The lib's own helpers are one-line function bodies, so the same idea with a different anchor.
lib_fmt_of() {
  sed -n "s/^$1(){ \(date [^ |]*\).*/\1/p" "$LIB" | head -1 | sed 's/%F/%Y-%m-%d/'
}

LIB_TODAY="$(lib_fmt_of cortex_today)"
LIB_STAMP="$(lib_fmt_of cortex_timestamp)"

# Guard the extractors themselves. A sed that silently matches nothing would make every assertion
# below compare "" with "" and pass — the failure mode a parity test exists to prevent.
assert_eq "date +%Y-%m-%d" "$LIB_TODAY" "the lib's day format was extracted"
assert_eq "date +%Y%m%d-%H%M%S" "$LIB_STAMP" "the lib's timestamp format was extracted"

INIT_TODAY="$(fmt_of "$REPO_ROOT/tools/cortex-init.sh" TODAY)"
INIT_STAMP="$(fmt_of "$REPO_ROOT/tools/cortex-init.sh" STAMP)"
CRON_TODAY="$(fmt_of "$REPO_ROOT/tools/server/cortex-cron.sh" today)"

assert_eq "$LIB_TODAY" "$INIT_TODAY" "cortex-init.sh stamps the day the same way as the lib"
assert_eq "$LIB_STAMP" "$INIT_STAMP" "cortex-init.sh stamps a timestamp the same way as the lib"
assert_eq "$LIB_TODAY" "$CRON_TODAY" "cortex-cron.sh stamps the day the same way as the lib (%F)"

# The helpers must actually run, not merely be spelled right.
assert_eq "0" "$(cortex_today >/dev/null 2>&1; echo $?)" "cortex_today runs"
TODAY_OUT="$(cortex_today)"
case "$TODAY_OUT" in
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) _pass "cortex_today emits YYYY-MM-DD" ;;
  *) _fail "cortex_today emits YYYY-MM-DD" "actual: $TODAY_OUT" ;;
esac
STAMP_OUT="$(cortex_timestamp)"
case "$STAMP_OUT" in
  [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]) _pass "cortex_timestamp emits YYYYmmdd-HHMMSS" ;;
  *) _fail "cortex_timestamp emits YYYYmmdd-HHMMSS" "actual: $STAMP_OUT" ;;
esac
EPOCH_OUT="$(cortex_epoch)"
case "$EPOCH_OUT" in
  ''|*[!0-9]*) _fail "cortex_epoch emits digits" "actual: $EPOCH_OUT" ;;
  *) _pass "cortex_epoch emits digits" ;;
esac

# cortex_today is LOCAL, matching core/date.js stamp(). If it ever became UTC it would disagree
# with the Node half for the first hours of every day east of Greenwich — the exact bug that put a
# capture into yesterday's daily note.
assert_eq "$(date +%Y-%m-%d)" "$(cortex_today)" "cortex_today reads local time, not UTC"

# No script may invent a date when `date` fails. `|| echo 2026-07-01` wrote a plausible wrong day
# into project frontmatter, and `|| echo 0` made every dormant repo classify as active. A stamp that
# cannot be taken is a hard failure, named — not a number nobody will question.
FALLBACKS="$(grep -rn 'date +[^)]*||[[:space:]]*echo[[:space:]]*[0-9]' "$REPO_ROOT/tools" --include='*.sh' || true)"
assert_eq "" "$FALLBACKS" "no script invents a literal date when date fails"
