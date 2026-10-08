# The agent team, stamped end to end on a real git fixture (plan step 14).
#
# This is the path /cortex follows: `cortex-loop.mjs --json` offers the team, `--team <roles>` gives
# the files, values and roster, `cortex-stamps.mjs render` writes each file, `record` records it. The
# promises it checks are the ones a user acts on:
#
#   - what is offered: every core role, the Project manager only with a plan folder, the verifier
#     the upgrade to the Reviewer, a covered role never again;
#   - every stamped file passes the claude-setup checker, and the Tester's fence refuses code;
#   - the record says every stamped file is current, and a template change reads as `update` and
#     is applied by `update` — the team is updated like any loop file.
#
# index/test/team.test.mjs covers the module from literals; this is the whole pipeline.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

LOOP="$REPO_ROOT/index/cortex-loop.mjs"
STAMPS="$REPO_ROOT/index/cortex-stamps.mjs"
INDEXER="$REPO_ROOT/index/cortex-index.mjs"
P="$WORK/team-repo"
TPL="$WORK/tpl"
IDX="$WORK/team-index.json"

field() { # json js-expression -> value, jq-free
  node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); const v = (0, eval)("(j) => " + process.argv[1])(j); process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));' "$2" <<< "$1"
}

# --- a repo with code, tests, a plan folder, a scoped brief, and the verifier an earlier pass stamped --

mkrepo "$P"
mkdir -p "$P/src/billing" "$P/test" "$P/docs/plans" "$P/.claude/agents" || exit 1
printf '{ "name": "demo", "scripts": { "test": "node --test", "dev": "node src/app.js" } }\n' > "$P/package.json"
printf 'export const app = () => 1;\n' > "$P/src/app.js"
printf 'import { app } from "../src/app.js";\n' > "$P/test/app.test.js"
printf '# plan\n' > "$P/docs/plans/next.md"
printf '# billing rules\n' > "$P/src/billing/AGENTS.md"
printf '# demo\n' > "$P/AGENTS.md"
printf '@AGENTS.md\n' > "$P/CLAUDE.md"
cp -r "$REPO_ROOT/templates" "$TPL"
node "$STAMPS" render loop/verifier.md --value "RUN=npm run dev" --templates "$TPL" > "$P/.claude/agents/verifier.md"
node "$STAMPS" record "$P" .claude/agents/verifier.md loop/verifier.md --value "RUN=npm run dev" --templates "$TPL" >/dev/null 2>&1
git -C "$P" add -A && git -C "$P" commit -q -m "an earlier /cortex pass"
node "$INDEXER" "$P" --out "$IDX" >/dev/null 2>&1
test_count() { node -e 'const i = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(i.stats.tests + " " + i.files.filter((f) => f.isTest).map((f) => f.path).join(","));' "$IDX"; }
tests_before="$(test_count)"

# --- the offer --------------------------------------------------------------------------------------

json="$(node "$LOOP" "$P" --index "$IDX" --json 2>&1)"
assert_eq '["architect","implementer","tester","project-manager"]' "$(field "$json" 'j.state.agentTeam.offer.map((o) => o.role)')" \
  "team: every core role is offered but the reviewer, and the Project manager with a plan folder"
assert_eq ".claude/agents/verifier.md" "$(field "$json" 'j.state.agentTeam.upgrade.path')" "team: the verifier is offered the upgrade"
assert_eq "npm run dev" "$(field "$json" 'j.state.agentTeam.values.RUN')" "team: the Reviewer's run command is the one the verifier was stamped with"
assert_eq "missing" "$(field "$json" '["missing","present","blocked"].find((b) => j[b].some((e) => e.id === "team"))')" "team: the row is on the worklist"

out="$(node "$LOOP" "$P" --index "$IDX" --team tester,boss 2>&1)"; rc=$?
assert_eq "1" "$rc" "team: a pick that is not a role is refused"
assert_contains "$out" "boss is not a role" "and the refusal names it"

# --- after the picks: architect, tester, the upgrade, the project manager ---------------------------

picks="$(node "$LOOP" "$P" --index "$IDX" --team architect,tester,reviewer,project-manager 2>&1)"
assert_eq "[]" "$(field "$picks" 'j.needs')" "team: every value was detected, so nothing is asked"
assert_eq '`architect`, `tester`, `reviewer`, `project-manager`' "$(field "$picks" 'j.values.ROSTER')" "team: the roster is the team as picked"
field "$picks" 'j.values' > "$WORK/values.json"

# Walk the files the way /cortex does: render each, append the playbook, retire the verifier.
while IFS='|' read -r template path mode; do
  case "$mode" in
    write)
      mkdir -p "$(dirname "$P/$path")" || exit 1
      node "$STAMPS" render "$template" --values-file "$WORK/values.json" --templates "$TPL" > "$P/$path"
      ;;
    append)
      { printf '\n'; node "$STAMPS" render "$template" --values-file "$WORK/values.json" --templates "$TPL"; } >> "$P/$path"
      ;;
  esac
done < <(field "$picks" 'j.files.map((f) => [f.template, f.path, f.mode].join("|")).join("\n")'; echo)
removed="$(field "$picks" 'j.upgrade.remove')"
assert_eq ".claude/agents/verifier.md" "$removed" "team: accepting the upgrade names the verifier to remove"
rm -f "$P/$removed"
node "$STAMPS" forget "$P" "$removed" >/dev/null 2>&1
while IFS='|' read -r template path; do
  [ -n "$path" ] || continue
  node "$STAMPS" record "$P" "$path" "$template" --values-file "$WORK/values.json" --templates "$TPL" >/dev/null 2>&1 \
    || _fail "team: record $path"
done < <(field "$picks" 'j.files.filter((f) => f.recorded).map((f) => [f.template, f.path].join("|")).join("\n")'; echo)
git -C "$P" add -A && git -C "$P" commit -q -m "the team"

assert_contains "$(cat "$P/CLAUDE.md")" '## Working as a team' "team: the playbook is appended to CLAUDE.md"
assert_contains "$(cat "$P/CLAUDE.md")" '`architect`, `tester`, `reviewer`, `project-manager`' "team: naming the team as picked"
assert_contains "$(cat "$P/.claude/agents/reviewer.md")" "npm run dev" "team: the Reviewer launches the change with the verifier's command"
assert_contains "$(cat "$P/.claude/hooks/test-paths.sh")" '"*/test/*"' "team: the fence lists the repo's own test location"
assert_not_contains "$(cat "$P/.claude/agents/architect.md")" "{{" "team: no placeholder is left in a stamped file"
assert_eq "absent" "$([ -e "$P/.claude/agents/verifier.md" ] && echo present || echo absent)" "team: the verifier the Reviewer replaced is gone"

# --- every stamped file passes the checker, and the fence holds -------------------------------------

node "$INDEXER" "$P" --out "$IDX" >/dev/null 2>&1
# The Tester's fence is named like a shell test. Installing the team must not change the count the
# findings and the drift check quote (#548): Cortex's own output would be changing its own report.
assert_eq "1 test/app.test.js" "$tests_before" "team: before the team, the repo has its one test"
assert_eq "$tests_before" "$(test_count)" "team: stamping the Tester's hook leaves the test count unchanged"
findings="$(node --input-type=module -e '
  import { pathToFileURL } from "node:url";
  import { readFileSync } from "node:fs";
  const [root, repo, idx] = process.argv.slice(1);
  const { claudeSetupFindings } = await import(pathToFileURL(root + "/index/lib/claude-setup.mjs").href);
  const found = claudeSetupFindings(JSON.parse(readFileSync(idx, "utf8")), repo);
  console.log(found.map((f) => f.kind + ": " + f.evidence.join(" | ")).join("\n") || "none");
' "$REPO_ROOT" "$P" "$IDX" 2>&1)"
assert_eq "none" "$findings" "team: every file /cortex stamped passes the claude-setup checker"

fence() { printf '{"tool_input":{"file_path":"%s"}}' "$P/$1" | CLAUDE_PROJECT_DIR="$P" bash "$P/.claude/hooks/test-paths.sh" >/dev/null 2>&1; echo "$?"; }
assert_eq "0" "$(fence test/new.test.js)" "team: the stamped fence lets the Tester edit a test"
assert_eq "2" "$(fence src/app.js)" "team: and refuses the code"

# --- the record: all current, then a template change is an update ------------------------------------

status="$(node "$STAMPS" "$P" --json --templates "$TPL" 2>&1)"
assert_eq "[]" "$(field "$status" 'j.files.filter((f) => f.state !== "current").map((f) => f.path + " " + f.state)')" "team: every recorded file is current"
assert_eq "6" "$(field "$status" 'j.files.length')" "team: four agents, the fence and the team skill are recorded; the playbook is not"

printf '\nOne more line in a newer release.\n' >> "$TPL/team/architect.md"
status="$(node "$STAMPS" "$P" --json --templates "$TPL" 2>&1)"
assert_eq "update" "$(field "$status" 'j.files.find((f) => f.path === ".claude/agents/architect.md").state')" "team: a changed template reads as update"
node "$STAMPS" update "$P" .claude/agents/architect.md --templates "$TPL" >/dev/null 2>&1
assert_contains "$(cat "$P/.claude/agents/architect.md")" "One more line in a newer release." "team: and update applies it"
assert_eq "current" "$(field "$(node "$STAMPS" "$P" --json --templates "$TPL" 2>&1)" 'j.files.find((f) => f.path === ".claude/agents/architect.md").state')" \
  "team: after which it is current again"

# --- a re-run: the team is present, and a covered role is never offered again -----------------------

json="$(node "$LOOP" "$P" --index "$IDX" --json 2>&1)"
assert_eq "present" "$(field "$json" '["missing","present","blocked"].find((b) => j[b].some((e) => e.id === "team"))')" "team: a re-run reads the team as present"
assert_eq '["implementer"]' "$(field "$json" 'j.state.agentTeam.offer.map((o) => o.role)')" "team: only the declined role is still on offer"
none="$(node "$LOOP" "$P" --index "$IDX" --team none 2>&1)"
assert_eq '["CLAUDE.md roster"]' "$(field "$none" 'j.files.map((f) => f.path + " " + f.mode)')" \
  "team: --team none picks no role, and the playbook already there only has its roster rewritten"

# --- a role Cortex stamped can be picked again, for values that changed since (#548) -----------------
# This used to be refused as "covered by `tester`", which left no CLI path to fresh values.

again="$(node "$LOOP" "$P" --index "$IDX" --team tester 2>&1)"; rc=$?
assert_eq "0" "$rc" "team: a role the stamp record holds can be picked again"
assert_eq '[".claude/agents/tester.md true",".claude/hooks/test-paths.sh true","CLAUDE.md undefined"]' \
  "$(field "$again" 'j.files.map((f) => f.path + " " + f.refresh)')" "team: its files come back marked refresh, and the playbook keeps its mode"
assert_eq "[]" "$(field "$again" 'j.needs')" "team: nothing answered on the first pass is asked again"

# A brief written after the index was built is on the Architect's list without a reindex.
mkdir -p "$P/src" && printf '# src\n' > "$P/src/AGENTS.md"
json="$(node "$LOOP" "$P" --index "$IDX" --json 2>&1)"
assert_eq '["SCOPED_BRIEFS"]' "$(field "$json" 'j.state.agentTeam.stamped.find((s) => s.role === "architect").changed')" \
  "team: the loop names the value that went stale"
again="$(node "$LOOP" "$P" --index "$IDX" --team architect 2>&1)"
assert_contains "$(field "$again" 'j.values.SCOPED_BRIEFS')" 'src/AGENTS.md' "team: and picking the Architect again carries the new brief"
rm "$P/src/AGENTS.md"

# The record is what makes the file Cortex's. Without the entry it is the team's own agent.
node "$STAMPS" forget "$P" .claude/agents/tester.md >/dev/null 2>&1
out="$(node "$LOOP" "$P" --index "$IDX" --team tester 2>&1)"; rc=$?
assert_eq "1" "$rc" "team: a covered role nobody recorded cannot be picked"
assert_contains "$out" 'covered by `tester`' "and the refusal names the agent that covers it"
