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

# --- the format-changed hook formats one file, and never blocks ------------------------------------
#
# settings.hooks.json ran this script for two releases before a template for it existed. It is a
# PostToolUse hook: the edit already happened, so every path out must be exit 0 — unreadable input,
# a missing file, a formatter that fails. With no detected formatter it has no case lines and must
# leave the file byte-for-byte alone.

fmt_src="$REPO_ROOT/templates/loop/format-changed.sh"
# A stub "formatter" that appends a marker, so the test can see exactly which files it touched.
stub_case='  *.go) printf "formatted\\n" >> "$path" ;;\n  *.bad) false ;;'
sed "s#{{FORMAT_CASES}}#$stub_case#" "$fmt_src" > "$WORK/fmt-default.sh"
sed "s#{{FORMAT_CASES}}#$stub_case#;s/if command -v jq >\/dev\/null 2>&1; then/if false; then/" "$fmt_src" > "$WORK/fmt-nojq.sh"
sed "s#{{FORMAT_CASES}}##" "$fmt_src" > "$WORK/fmt-empty.sh"

fmt_exit() { printf '%s' "$2" | bash "$WORK/fmt-$1.sh" >/dev/null 2>&1; echo "$?"; }

for mode in default nojq; do
  printf 'package main\n' > "$WORK/main.go"
  printf 'x\n' > "$WORK/notes.txt"
  assert_eq "0" "$(fmt_exit "$mode" "{\"tool_input\":{\"file_path\":\"$WORK/main.go\"}}")" \
    "format hook ($mode): a matching file exits 0"
  assert_contains "$(cat "$WORK/main.go")" "formatted" "format hook ($mode): and the formatter ran on it"
  fmt_exit "$mode" "{\"tool_input\":{\"file_path\":\"$WORK/notes.txt\"}}" >/dev/null
  assert_eq "x" "$(cat "$WORK/notes.txt")" "format hook ($mode): a file no formatter claims is left alone"
done
printf 'y\n' > "$WORK/broken.bad"
assert_eq "0" "$(fmt_exit default "{\"tool_input\":{\"file_path\":\"$WORK/broken.bad\"}}")" \
  "format hook: a formatter that fails still exits 0 — PostToolUse has nothing left to block"
assert_eq "0" "$(fmt_exit default '{"tool_input":{"file_path": 42}}')" "format hook: unreadable input exits 0"
assert_eq "0" "$(fmt_exit default '{"tool_input":{"file_path":"/no/such/file.go"}}')" "format hook: a missing file exits 0"
printf 'package main\n' > "$WORK/main.go"
assert_eq "0" "$(fmt_exit empty "{\"tool_input\":{\"file_path\":\"$WORK/main.go\"}}")" \
  "format hook: with no detected formatter it still exits 0"
assert_eq "package main" "$(cat "$WORK/main.go")" "format hook: and changes nothing"

# --- /cortex reconciles an existing agent doc before it scaffolds ----------------------------------
#
# The first /cortex left this out. On a repo with a hand-written CLAUDE.md the scaffold, which never
# clobbers, wrote AGENTS.generated.md beside it — the double-file a single install exists to avoid.
# The step lives in prose, so the test is that the prose is there and routes to the right ritual.

cortex_skill="$(cat "$REPO_ROOT/skills/cortex/SKILL.md")"
assert_contains "$cortex_skill" "/optimize-context" "/cortex routes a pre-existing agent doc to /optimize-context"
assert_contains "$cortex_skill" "reconcile" "and reads the reconcile step off cortex-next rather than re-deriving it"

# The trigger collision: only /cortex may claim "set up". /cortex-install used to carry the same
# install phrases, and two model-invocable skills on one trigger means the model picks at random.
install_desc="$(sed -n 's/^description: //p' "$REPO_ROOT/skills/cortex-install/SKILL.md")"
assert_not_contains "$install_desc" "set up cortex" "/cortex-install no longer claims the set-up trigger"
assert_not_contains "$install_desc" "install cortex here" "nor the install trigger"

# --- agent-evals.yml runs every case, and survives the first PR ------------------------------------
#
# Found by the Harbor proving ground: the stamped workflow failed the PR that added AGENTS.md, since
# with no cases the glob ran literally under `set -e`. One failing case also aborted every case
# after it, accept.sh needed an executable bit nobody sets, and each case ran on the last one's
# edits. The step's own script is run here, lifted out of the parsed template, against a stub
# `claude` — the index test checks the workflow's shape, this checks what the script does.

node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  import { pathToFileURL } from "node:url";
  const [root, out] = process.argv.slice(1);
  const { parseYaml } = await import(pathToFileURL(root + "/index/test/yaml-lite.mjs").href);
  const src = readFileSync(root + "/templates/loop/agent-evals.yml", "utf8")
    .replace(/^[ \t]*\{\{SETUP_STEPS\}\}[ \t]*$/m, "")
    .replaceAll("{{TEST_CMD}}", "make test");
  writeFileSync(out, parseYaml(src).jobs.cases.steps.find((s) => /claude -p/.test(s.run ?? "")).run);
' "$REPO_ROOT" "$WORK/evals-run.sh"

mkdir -p "$WORK/evals-bin" "$WORK/evals-tmp"
cat > "$WORK/evals-bin/claude" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_LOG"
case "$2" in *crash*) echo '{"is_error":true,"result":"Invalid API key"}'; exit 1 ;; esac
echo edit >> README.md
echo '{"is_error":false,"result":"done"}'
STUB
chmod +x "$WORK/evals-bin/claude"

evals_repo="$WORK/evals-repo"
mkrepo "$evals_repo"
printf '# r\n' > "$evals_repo/README.md"
git -C "$evals_repo" add -A && git -C "$evals_repo" commit -q -m readme

evals() { # key → "<exit>\n<output>", run from the repo root the way the job runs it
  (
    cd "$evals_repo" || exit 1
    PATH="$WORK/evals-bin:$PATH" ANTHROPIC_API_KEY="$1" RUNNER_TEMP="$WORK/evals-tmp" \
      STUB_LOG="$WORK/evals-stub.log" bash "$WORK/evals-run.sh" 2>&1
    echo "exit=$?"
  )
}

out="$(evals "")"
assert_contains "$out" "exit=0" "evals: a run with no API key (a fork's PR) exits 0"
assert_contains "$out" "cases skipped" "and says why it ran nothing"

out="$(evals "k")"
assert_contains "$out" "exit=0" "evals: the PR that adds AGENTS.md, before any case exists, passes"
assert_contains "$out" "holds no cases yet" "and says what to add"

# Four cases, committed with no executable bit. a crashes, b passes, c is rejected by its accept.sh,
# d passes only if README.md carries exactly one edit — i.e. the tree was reset after b and c.
for c in a-crash b-good c-reject d-clean; do mkdir -p "$evals_repo/evals/cases/$c"; done
printf 'crash please\n' > "$evals_repo/evals/cases/a-crash/prompt.md"
printf 'exit 0\n'       > "$evals_repo/evals/cases/a-crash/accept.sh"
printf 'do it\n'        > "$evals_repo/evals/cases/b-good/prompt.md"
printf 'grep -q "\\"is_error\\":false" "$1"\n' > "$evals_repo/evals/cases/b-good/accept.sh"
printf 'do it\n'        > "$evals_repo/evals/cases/c-reject/prompt.md"
printf 'exit 1\n'       > "$evals_repo/evals/cases/c-reject/accept.sh"
printf 'do it\n'        > "$evals_repo/evals/cases/d-clean/prompt.md"
printf '[ "$(grep -c "^edit$" README.md)" = 1 ]\n' > "$evals_repo/evals/cases/d-clean/accept.sh"
chmod -x "$evals_repo"/evals/cases/*/accept.sh
git -C "$evals_repo" add -A && git -C "$evals_repo" commit -q -m cases

out="$(evals "k")"
assert_contains "$out" "FAIL  a-crash" "evals: a run that exits non-zero is a failure"
assert_contains "$out" "pass  b-good" "and the cases after it still run, with accept.sh run through bash"
assert_contains "$out" "FAIL  c-reject" "a case its accept.sh rejects fails"
assert_contains "$out" "pass  d-clean" "each case starts from the committed tree, not the last case's edits"
assert_contains "$out" "exit=1" "and any failure fails the job"
assert_contains "$(cat "$WORK/evals-stub.log")" "Bash(make test *)" "the test command is allowed as a prefix rule"
assert_contains "$(cat "$WORK/evals-stub.log")" "--permission-mode dontAsk" "and nothing else is left waiting on a prompt"
