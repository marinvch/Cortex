# A link from a ritual to its supporting file resolves, heading included.
#
# A ritual's body stays short by moving detail into a file beside it and linking to the section.
# That link is the only way the detail is reached. Rename the heading and a model following
# `RUNS.md#running-unattended` finds nothing, carries on without it, and nothing fails. This is the
# check for skills/ that changing-cortex.test.sh is for docs/changing-cortex.md, where eight links
# broke in one move and the first version of the check resolved them from the wrong directory.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

LINKS="$REPO_ROOT/tools/cortex-skill-links.mjs"

out="$(node "$LINKS" --check 2>&1)"; rc=$?
assert_eq "0" "$rc" "every link from a ritual in this repo resolves"
assert_contains "$out" "links from a ritual to a file or a heading resolve" "and it says how many it followed"

# --- and it can actually fail -----------------------------------------------------------------------
#
# On a fixture, one case per way a link dies. The links that must NOT be reported sit beside them:
# a check that flags an example inside a code fence would be switched off within a week.
F="$WORK/links"
mkdir -p "$F/skills/alpha" "$F/skills/beta" "$F/docs"
printf '# A decision\n' > "$F/docs/adr.md"
cat > "$F/skills/alpha/RUNS.md" <<'MD'
# Runs

## Running unattended

Text.

## Running unattended

The second heading of the same name.

## What `--yes` does, exactly?
MD
cat > "$F/skills/beta/SKILL.md" <<'MD'
# beta

## Its own heading
MD
cat > "$F/skills/alpha/SKILL.md" <<'MD'
# alpha

Good: [runs](RUNS.md), [unattended](RUNS.md#running-unattended), [the second](RUNS.md#running-unattended-1),
[punctuation](RUNS.md#what---yes-does-exactly), [here](#alpha), [beta](../beta/SKILL.md#its-own-heading),
[a decision](../../docs/adr.md), [the docs](https://example.com/docs#nothing), [a folder](../beta), and a link
whose text [wraps across
lines](RUNS.md#running-unattended).

Not links to check: `[in a span](GONE.md)`, [a placeholder](<area>/AGENTS.md), [another](${ROOT}/x.md).

```markdown
[an example of what the ritual writes](billing/AGENTS.md)
```

Dead: [no file](MISSING.md), [renamed heading](RUNS.md#running-with-nobody-there),
[wrong folder](docs/adr.md), [no such heading here](#nowhere), [a third that is not there](RUNS.md#running-unattended-2).
MD

out="$(node "$LINKS" "$F" 2>&1)"; rc=$?
assert_eq "0" "$rc" "without --check the report prints and exits 0"
assert_contains "$out" "5 of 14 links from a ritual lead nowhere" "five dead links of the fourteen followed (a URL and a placeholder are not followed)"
assert_contains "$out" "skills/alpha/SKILL.md:15  MISSING.md" "a missing file is named with its line"
assert_contains "$out" 'no heading "#running-with-nobody-there" in skills/alpha/RUNS.md' "a renamed heading is named with the file it is not in"
assert_contains "$out" "docs/adr.md  — no file at skills/alpha/docs/adr.md" "a path is resolved from the linking file, not the repo root"
assert_contains "$out" 'no heading "#nowhere" in skills/alpha/SKILL.md' "a bare #anchor is checked against the same file"
assert_contains "$out" "running-unattended-2" "a numbered repeat that does not exist is dead"
assert_not_contains "$out" "GONE.md" "a link in a code span is not checked"
assert_not_contains "$out" "billing/AGENTS.md" "nor one in a code fence"
assert_not_contains "$out" "<area>" "nor a placeholder"
assert_not_contains "$out" "example.com" "nor a URL"
assert_exit 1 "--check exits 1 on a dead link" -- node "$LINKS" "$F" --check

# A check that followed no link at all has proved nothing: a loop that never runs reports no dead links.
E="$WORK/links-empty"
mkdir -p "$E/skills/alpha"
printf '# alpha\n\nNo links here.\n' > "$E/skills/alpha/SKILL.md"
out="$(node "$LINKS" "$E" --check 2>&1)"; rc=$?
assert_eq "1" "$rc" "--check fails when it found no link to follow"
assert_contains "$out" "not a pass" "and says that reading nothing is not a pass"
