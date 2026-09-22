# cortex-loop.mjs — what the SDLC artifact chain is missing, and why.
#
# Every case here is a defect this module actually shipped on its first run against a real
# repository, not a scenario invented at a desk. Fixtures are shaped like the repos that broke it.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

LOOP="$REPO_ROOT/index/cortex-loop.mjs"

run() { node "$LOOP" "$WORK/$1" "${@:2}" 2>&1; }

# A repo with real source and a manifest, and nothing from the loop.
fresh_repo() {
  rm -rf "${WORK:?}/$1"
  mkdir -p "$WORK/$1/src" || exit 1
  printf 'export const a = 1;\n' > "$WORK/$1/src/a.js"
  printf 'import { a } from "./a.js";\nexport const b = a;\n' > "$WORK/$1/src/b.js"
}

# --- an unbuilt index is an unanswered question, never an answer -----------------------------------
#
# The first run of this module printed "Greenfield: no code yet" over several hundred files,
# because `stats.files ?? 0` was 0 when no index had been built. Absence of a measurement is not a
# measurement of absence, and the cost of getting this backwards is telling a user their codebase
# does not exist.

fresh_repo populated
out="$(run populated)"
assert_not_contains "$out" "Greenfield" "a populated repo with no index is never called greenfield"
assert_contains "$out" "No index yet" "and the missing index is said out loud instead of inferred from"

# The property, not the symptom: with no index, nothing may claim a detection either way.
assert_not_contains "$out" "no dependency manifest found" \
  "with no index, the stack reads as unread rather than as detected-and-empty"

# --- no evidence sentence may render a hole --------------------------------------------------------
#
# "null runs here — a verdict from a fresh context…" printed on the first real run, from a `why`
# that interpolated a command the repo did not declare. A `why` is the one part of a report a reader
# can check against their own repo, so a sentence that is visibly wrong once discredits every row
# they cannot check.
#
# Asserted over the WHOLE rendered output and across several repo shapes, because naming the one
# sentence that broke would pass for every other way of breaking.

for shape in populated empty withpkg; do
  case "$shape" in
    populated) fresh_repo "$shape" ;;
    empty)     rm -rf "${WORK:?}/$shape"; mkdir -p "$WORK/$shape" || exit 1 ;;
    withpkg)
      fresh_repo "$shape"
      printf '{"name":"x","scripts":{"test":"vitest","build":"tsc"}}\n' > "$WORK/$shape/package.json"
      ;;
  esac
  rendered="$(run "$shape")"
  assert_not_contains "$rendered" "null" "no rendered sentence contains a hole ($shape)"
  assert_not_contains "$rendered" "undefined" "nor an undefined ($shape)"
done

# --- a detected command is quoted verbatim, and an undetected one is never invented -----------------
#
# The whole Test stage rests on this. A CLAUDE.md telling an agent to run `npm test` in a repo with
# no test script fails the first time it runs, and a context file that is wrong once is not trusted.

out="$(run withpkg)"
assert_contains "$out" "npm test" "a declared test script is quoted as the command"
assert_contains "$out" "npm run build" "and so is a declared build script"

fresh_repo nopkg
out="$(run nopkg)"
assert_not_contains "$out" "npm test" "a repo with no manifest is never told to run npm test"
assert_contains "$out" "no runnable command declared yet" "it says nothing was declared instead"

# --- a blocked artifact names what it is waiting on ------------------------------------------------
#
# The first version printed "(waiting on an earlier artifact)" and left the user to guess which.
# That is the offer-vanishes failure wearing a label: neither version tells them how to unlock it.

out="$(run nopkg)"
assert_contains "$out" "needs:" "a blocked row names its prerequisite"
assert_contains "$out" "REVIEW.md — the gate" "and names it specifically, not as 'something earlier'"
assert_contains "$out" "listed above, not dropped" "and the run says blocked rows were not discarded"

# --- an artifact already on disk is reported present, never re-offered -----------------------------
#
# A hollow REVIEW.md still counts. Silently replacing a file someone wrote is the worse failure, so
# presence is a file fact and never a quality judgment.

fresh_repo served
printf '# Review instructions\n' > "$WORK/served/REVIEW.md"
out="$(run served)"
assert_contains "$out" "✓" "an artifact on disk is marked present"

before="$(cat "$WORK/served/REVIEW.md")"
run served >/dev/null
assert_eq "$before" "$(cat "$WORK/served/REVIEW.md")" "and reading the loop does not touch it"

# --- read-only, in the strongest sense --------------------------------------------------------------
#
# The product's central claim. Assert the whole tree is byte-identical rather than checking for a
# stray .cortex/ — a test naming one symptom passes for every other way of failing.

fresh_repo untouched
fingerprint() { find "$WORK/untouched" -type f | sort | while read -r f; do printf '%s %s\n' "$f" "$(wc -c < "$f")"; done; }
snapshot="$(fingerprint)"
run untouched >/dev/null
run untouched --json >/dev/null
run untouched --line >/dev/null
assert_eq "$snapshot" "$(fingerprint)" "three runs leave the target tree byte-identical"
assert_eq "absent" "$([ -e "$WORK/untouched/.cortex" ] && echo present || echo absent)" \
  "and create no .cortex/"

# --- --json is the ritual's input, and carries what the ritual needs --------------------------------

json="$(run withpkg --json)"
for key in '"missing"' '"present"' '"blocked"' '"needs"' '"brief"' '"stage"' '"why"'; do
  assert_contains "$json" "$key" "--json carries $key for /cortex to walk"
done

# The six stages, in loop order, so a caller can group by them without inventing the order.
assert_contains "$json" '"plan"' "--json names the stages"
assert_contains "$json" '"maintain"' "including the one that closes the loop"

# --- the protected-paths hook blocks, permits, and fails CLOSED ------------------------------------
#
# Claude Code treats any exit but 2 as a non-blocking error. The first version read the path with jq
# under `set -e`, so on a machine without jq it died with 127 and every edit went through — a guard
# that reports nothing while guarding nothing. Both readers are exercised: the jq one where jq
# exists, and the sed fallback forced on, since this machine may well have jq.

hook_src="$REPO_ROOT/templates/loop/protected-paths.sh"
fill_hook() { sed 's#{{PROTECTED_PATTERNS}}#  "*/gen/*"#;s#{{PROTECTED_LIST}}#test#' "$hook_src"; }
fill_hook > "$WORK/hook-default.sh"
fill_hook | sed 's/if command -v jq >\/dev\/null 2>&1; then/if false; then/' > "$WORK/hook-nojq.sh"

hook_exit() { printf '%s' "$2" | bash "$WORK/hook-$1.sh" >/dev/null 2>&1; echo "$?"; }

for mode in default nojq; do
  assert_eq "2" "$(hook_exit "$mode" '{"tool_input":{"file_path":"src/gen/api.ts"}}')" \
    "hook ($mode): an edit under a protected path is blocked with exit 2"
  assert_eq "0" "$(hook_exit "$mode" '{"tool_input":{"file_path":"src/main.go"}}')" \
    "hook ($mode): an ordinary path is let through"
  assert_eq "0" "$(hook_exit "$mode" '{"tool_input":{"command":"ls"}}')" \
    "hook ($mode): input with no file_path is not its business"
done
assert_eq "2" "$(hook_exit nojq '{"tool_input":{"file_path": 42}}')" \
  "hook: a file_path it cannot read is refused, never waved on"

blocked_msg="$(printf '%s' '{"tool_input":{"file_path":"src/gen/api.ts"}}' | bash "$WORK/hook-default.sh" 2>&1 >/dev/null)"
assert_contains "$blocked_msg" "Change the source it is generated from" \
  "hook: a block explains itself and names the route forward"
