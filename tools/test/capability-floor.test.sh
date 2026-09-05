# Every ritual declares what it needs from the setup running it.
#
# Cortex names self-hosted and own-LLM setups as an audience (ADR 0008) and gave them nothing to
# consult: a ritual needing multi-round judgment looked exactly like one that appends a line to a
# file. The failure this prevents is not a crash. A weak model runs /cortex-enrich, writes
# plausible-but-wrong summaries for every file, and those summaries feed `recall` — so it is not a
# bad answer once, it is a bad answer every time anyone searches, and nothing announces it.
#
# core/test/plugin.test.js asserts the frontmatter. This asserts the CLI that reads it, because a
# table nobody can print is a table nobody consults.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

VER="$REPO_ROOT/tools/cortex-capability.mjs"

out="$(node "$VER" 2>&1)"; rc=$?
assert_eq "0" "$rc" "the capability table prints, and exits 0 when every ritual is declared"
assert_contains "$out" "mechanical" "it groups by tier"
assert_contains "$out" "judgment" "it lists the judgment tier"
assert_contains "$out" "strong" "it lists the strong tier"

# The tiers must be genuinely different sets. If every ritual landed in one bucket the declaration
# would be decoration, which is the failure mode of a classification nobody thought about.
mech="$(node "$VER" mechanical 2>&1 | grep -c '^  /')"
strong="$(node "$VER" strong 2>&1 | grep -c '^  /')"
if [ "$mech" -gt 0 ] && [ "$strong" -gt 0 ] && [ "$mech" != "$strong" ]; then
  _pass "the tiers hold different rituals ($mech mechanical, $strong strong)"
else
  _fail "the tiers hold different rituals" "mechanical=$mech strong=$strong"
fi

# The rituals a self-hosted setup most needs to know are safe.
for r in capture daily cortex-install; do
  assert_contains "$(node "$VER" mechanical 2>&1)" "/$r" "/$r runs anywhere"
done

# And the ones that do lasting damage on a weak model are NOT in the safe tier.
for r in cortex-enrich level-up grilling; do
  assert_not_contains "$(node "$VER" mechanical 2>&1)" "/$r" "/$r is not advertised as safe anywhere"
done

# Every strong ritual offers an alternative. A declared floor with no way under it is a wall.
# Count only ritual LINES: the tier header also contains the phrase "has a degraded path", which
# is why the first version of this assertion reported 7 of 6.
count="$(node "$VER" strong 2>&1 | grep -c '^  /.*has a degraded path')"
total="$(node "$VER" strong 2>&1 | grep -c '^  /')"
assert_eq "$total" "$count" "every strong ritual says what to do below the floor"

# An unknown tier is refused rather than silently printing nothing.
out="$(node "$VER" enormous 2>&1)"; rc=$?
assert_eq "2" "$rc" "an unknown tier is refused"
assert_contains "$out" "Expected one of" "and names the valid set"
