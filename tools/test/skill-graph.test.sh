# No ritual is stranded, and the escape hatch from that rule has to say what it is escaping to.
#
# The defect this pins has no error state. A ritual nothing points at still runs when you type its
# name — it is simply never *reached*, so only a user who already knows it exists ever gets to it.
# /wizard and /team-add each sat that way for months: /team-init created a team-brain and never named
# the command a member runs to join it, and every ritual that scaffolded a repo needing manual
# credential setup re-explained the steps in prose instead of handing off to the skill that writes
# the script. Nothing failed. The work was just done twice, worse, by whoever went second.
#
# This is the same rule AGENTS.md applies to prose — define a thing once and point at it from
# everywhere else — measured on the rituals rather than asserted about them.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

GRAPH="$REPO_ROOT/tools/cortex-skill-graph.mjs"

out="$(node "$GRAPH" 2>&1)"; rc=$?
assert_eq "0" "$rc" "the skill graph prints and exits 0 when nothing is stranded"
assert_contains "$out" "rituals" "it says how many rituals it walked"

# --- the check itself ------------------------------------------------------------------------------

assert_exit 0 "--check passes: no ritual is isolated in both directions" -- node "$GRAPH" --check

# --- and it can actually fail -----------------------------------------------------------------------
#
# A guard that has never been seen to fail is indistinguishable from one that cannot. Plant a ritual
# that names nothing and is named by nothing, and confirm --check catches it. Under $REPO_ROOT
# because the tool resolves skills/ relative to its own location, so a temp dir would not be walked.
stranded="$REPO_ROOT/skills/zz-graph-test-fixture"
mkdir -p "$stranded"
cat > "$stranded/SKILL.md" <<'FIXTURE'
---
name: zz-graph-test-fixture
description: Fixture. Names no ritual and is named by none.
capability: mechanical
---

# fixture

Deliberately mentions nothing.
FIXTURE
trap 'rm -rf "$stranded"' EXIT

assert_exit 1 "--check fails when a ritual is isolated in both directions" -- node "$GRAPH" --check
planted="$(node "$GRAPH" 2>&1)"
assert_contains "$planted" "zz-graph-test-fixture" "and names the stranded ritual so it is actionable"

# The escape hatch has to work, or the next externally-triggered ritual gets a decorative link
# invented for it just to make the check green — which is the check making the repo worse.
cat > "$stranded/SKILL.md" <<'FIXTURE'
---
name: zz-graph-test-fixture
description: Fixture. Names no ritual and is named by none, but declares its trigger.
capability: mechanical
reached-by: a fixture, so that this test can assert the hatch opens
---

# fixture

Deliberately mentions nothing.
FIXTURE

assert_exit 0 'a declared reached-by: trigger satisfies the check' -- node "$GRAPH" --check
declared="$(node "$GRAPH" 2>&1)"
assert_contains "$declared" "reached from outside: /zz-graph-test-fixture" \
  "and it is still reported, because an external trigger is a claim someone must re-read"

rm -rf "$stranded"
trap - EXIT

# --- the declarations themselves ----------------------------------------------------------------------
#
# Asserted on the frontmatter, not on the graph's `external` list. A declared trigger and an inbound
# edge are not alternatives: /resolving-merge-conflicts is reached by an interrupted rebase AND, since
# /ship exists, by a ritual — so it correctly left the external list while its declaration stayed
# true. An earlier version of this test asserted the list, and adding the honest edge broke it, which
# is a test punishing the repo for improving.
for name in optimize-prompt resolving-merge-conflicts; do
  line="$(grep -m1 '^reached-by:' "$REPO_ROOT/skills/$name/SKILL.md" 2>/dev/null || true)"
  if [ -n "$line" ]; then
    _pass "/$name declares what reaches it from outside a ritual"
  else
    _fail "/$name declares what reaches it from outside a ritual" \
      "no reached-by: line — a hook-driven or git-driven ritual has to say so"
  fi
done

# A `reached-by:` with no substance would be the check switched off while still reading as green.
if grep -hE '^reached-by:' "$REPO_ROOT"/skills/*/SKILL.md | grep -qE '^reached-by:\s*(true|yes|1)\s*$'; then
  _fail "every reached-by: names a real trigger" "found a bare true/yes/1 — that is the guard disabled, not an exception"
else
  _pass "every reached-by: names a real trigger rather than a bare true"
fi
