# Every shipped shell tool that deletes either routes through the root guard, or says why not.
#
# The invariant is in docs/changing-cortex.md and ADR 0010: a destructive shell tool routes its
# target through resolve_in_root(), because a symlink out of the root passes any string-prefix
# comparison and is still an escape. tools/cortex-rm.sh got the guard when the ADR was written.
# tools/cortex-sync-skills.sh did not — it ran `rm -rf "${DST:?}/$name"` and never sourced the lib
# at all — and nothing caught that for a year, because the only test of the rule was the one
# cortex-rm.test.sh makes about cortex-rm.
#
# So this asserts the PROPERTY over every tool, not the one instance someone thought of. A test
# naming a single script passes for every future tool that forgets.
#
# The exemption is explicit, never an allowlist by filename. A tool whose deletions cannot take a
# caller-supplied path says so in its header, in a marker this scan reads, followed by the reason.
# The reason is the point: "someone checked once" belongs at the top of the file, not in a plan
# document from 2026-08-18 — which is exactly where the claim about cortex-vault-extract.sh lived,
# where no reader of that script would ever find it.
#
# An exemption on a file that no longer deletes anything is removed, not kept for a rainy day —
# same rule dormant-exemptions.test.sh applies to the secrets marker, and for the same reason: a
# stale marker is a blanket permission nobody re-reads.
#
# The marker is written by concatenation on purpose. Spelled out, this file would exempt itself
# from the rule it enforces — the self-matching trap dormant-exemptions.test.sh and
# no-private-names.test.sh both name.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

cd "$REPO_ROOT" || exit 1

MARKER="cortex:""no-root-guard"

# Only a marker in the HEADER is a claim about the file. Further down it is prose about the
# mechanism, the same distinction dormant-exemptions.test.sh draws.
HEADER_LINES=30

# Scope: the tools a person runs. tools/test/ is the harness, not a tool anyone points at a path,
# and its one `rm -rf` is run.sh clearing the temp dir it made itself. tools/server/ IS in scope:
# those scripts cannot source the shared lib (they land on a server beside only server-setup.sh),
# so if one ever grows a delete, the marker is the answer and it must be argued out loud.
TOOLS="$(ls tools/*.sh tools/server/*.sh 2>/dev/null)"

# Comment lines are not code. Several of these files discuss `rm -rf` in prose — including the two
# that perform it — and judging prose would make the scan unusable.
code_of() { sed -e 's/^[[:space:]]*#.*$//' "$1"; }

# `mv` counts. ADR 0010's original finding was not a delete at all — `cortex-rm.sh ../outside/x.md`
# MOVED a file from outside the vault into archives/removed/, erasing where it came from. A scan
# that watched only `rm` would have missed the case the rule was written about.
deletes_in() { # file -> the offending lines, numbered, or nothing
  code_of "$1" | grep -nE '(^|[;&|(){}[:space:]])(rm|rmdir|shred|mv)[[:space:]]|[[:space:]]-delete([[:space:]]|$)' || true
}

exempt_reason() { # file -> the text after the marker, or nothing
  head -n "$HEADER_LINES" "$1" | grep -F "$MARKER" | head -1 \
    | sed "s/.*$MARKER//" | sed 's/^[^[:alnum:]]*//' | tr -d '\r'
}

guards_in() { # file -> a resolve_in_root call in CODE, not a mention in a comment
  code_of "$1" | grep -q 'resolve_in_root'
}

# --- the canary --------------------------------------------------------------
#
# A scan that matches nothing passes every file. Prove the detector fires before trusting it to
# stay quiet: a script that deletes, with no marker and no guard, must be caught.
mkdir -p "$WORK/canary"
cat > "$WORK/canary/bad.sh" <<'CANARY'
#!/usr/bin/env bash
# a comment mentioning rm -rf must not count
set -eu
rm -rf "$1"
CANARY
assert_contains "$(deletes_in "$WORK/canary/bad.sh")" "rm -rf" "the detector finds an unguarded delete"
printf '#!/usr/bin/env bash\nmv "$1" /elsewhere\n' > "$WORK/canary/move.sh"
assert_contains "$(deletes_in "$WORK/canary/move.sh")" "mv" "and a move, which is what ADR 0010 was written about"
assert_eq "" "$(exempt_reason "$WORK/canary/bad.sh")" "and finds no exemption where none is declared"

cat > "$WORK/canary/prose.sh" <<'CANARY'
#!/usr/bin/env bash
# this script explains that rm -rf is dangerous and does not run it
echo hello
CANARY
assert_eq "" "$(deletes_in "$WORK/canary/prose.sh")" "a delete discussed only in a comment is not a delete"

# --- the property ------------------------------------------------------------

violations=""
unreasoned=""
dormant=""
guarded=0
scanned=0

for f in $TOOLS; do
  [ -f "$f" ] || continue
  scanned=$((scanned + 1))
  dels="$(deletes_in "$f")"
  reason="$(exempt_reason "$f")"

  if [ -n "$dels" ]; then
    if [ -n "$reason" ]; then
      # A marker with a shrug for a reason is the check switched off wearing the check's clothes.
      [ "${#reason}" -ge 30 ] || unreasoned="$unreasoned$f
"
    elif guards_in "$f"; then
      guarded=$((guarded + 1))
    else
      violations="$violations$f
$(printf '%s\n' "$dels" | sed 's/^/      /')
"
    fi
  elif [ -n "$reason" ]; then
    dormant="$dormant$f
"
  fi
done

assert_eq 1 "$([ "$scanned" -ge 6 ] && echo 1 || echo 0)" "the scan found the shell tools ($scanned files)"
assert_eq 1 "$([ "$guarded" -ge 1 ] && echo 1 || echo 0)" \
  "at least one tool routes a delete through resolve_in_root ($guarded do)"

if [ -z "$violations" ]; then
  _pass "every shell tool that deletes routes through resolve_in_root or declares an exemption"
else
  _fail "every shell tool that deletes routes through resolve_in_root or declares an exemption" \
    "$(printf 'these delete without the guard and without a declared exemption:\n%s' "$violations")" \
    "source tools/_cortex-lib.sh and route the target through resolve_in_root," \
    "or add a '$MARKER' line to the header saying why no path needs resolving."
fi

if [ -z "$unreasoned" ]; then
  _pass "every declared exemption states a reason"
else
  _fail "every declared exemption states a reason" \
    "$(printf 'these carry the marker with nothing after it:\n%s' "$unreasoned")"
fi

if [ -z "$dormant" ]; then
  _pass "no exemption sits on a file that has stopped deleting anything"
else
  _fail "no exemption sits on a file that has stopped deleting anything" \
    "$(printf 'these claim an exemption but delete nothing — remove the marker:\n%s' "$dormant")"
fi

# The rule has to be findable from the file that states it, or the next author meets it only as a
# red test with no argument behind it.
assert_contains "$(cat docs/changing-cortex.md)" "resolve_in_root" \
  "docs/changing-cortex.md still states the rule this test enforces"
