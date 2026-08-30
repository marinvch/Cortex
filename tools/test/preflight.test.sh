# The preflight answers three questions, and the third one is a gate.
#
# Root, profile and index freshness are what every ritual needs before it may write, and each used to
# restate them in prose. The gate is the path check: `git check-ignore` is what AGENTS.md demands
# before archiving personal content — "archiving is not sanitizing" — and a ritual that gets that
# wrong writes a private note into a tracked file. So a COMMITTED verdict has to be a non-zero exit
# and not merely a line of output, because a caller that only reads stdout will not read it.

PF="$REPO_ROOT/tools/cortex-preflight.mjs"

# A real git repo in a temp dir: the tool asks git for the toplevel and for check-ignore, so a fake
# directory would exercise none of the behaviour that matters. $HOME is overridden per run.sh's rule.
work="$(mktemp -d)"
export HOME="$work/home"
mkdir -p "$HOME"
repo="$work/repo"
mkdir -p "$repo/sub/deep"
(
  cd "$repo"
  git init -q .
  git config user.email t@example.com
  git config user.name Test
  printf 'secret/\n' > .gitignore
  mkdir -p secret
  printf 'x\n' > tracked.md
  printf 'x\n' > secret/private.md
  git add -A && git commit -qm init
) >/dev/null 2>&1

# --- the gate --------------------------------------------------------------------------------------

assert_exit 0 "no paths named — the report alone always exits 0" -- node "$PF"

assert_exit 1 "a path that would be COMMITTED exits non-zero" \
  -- env -C "$repo" node "$PF" tracked.md

assert_exit 0 "a gitignored path exits 0 — it is safe to write personal content there" \
  -- env -C "$repo" node "$PF" secret/private.md

out="$(cd "$repo" && node "$PF" tracked.md 2>&1)"
assert_contains "$out" "COMMITTED" "and says so in words, not only in the exit code"

out="$(cd "$repo" && node "$PF" secret/private.md 2>&1)"
assert_contains "$out" ".gitignore" "an ignored path cites the rule that matched, so it can be checked"

# --- root is the toplevel, not the cwd ---------------------------------------------------------------
#
# A ritual invoked from a subdirectory that resolves paths against cwd writes into the wrong half of
# the repo, and the file lands somewhere plausible — the mistake is silent, which is why this is
# asserted rather than assumed.
sub="$(cd "$repo/sub/deep" && node "$PF" --json 2>&1)"
case "$sub" in
  *'"root"'*repo*) _pass "run from a subdirectory, root is still the repo toplevel" ;;
  *) _fail "run from a subdirectory, root is still the repo toplevel" "got: $(printf '%s' "$sub" | head -c 200)" ;;
esac

# --- the profile is declared, never detected ----------------------------------------------------------

out="$(cd "$repo" && CORTEX_PROFILE=work node "$PF" 2>&1)"
assert_contains "$out" "refuses: personal" "CORTEX_PROFILE=work reads the firewall from the other side"

out="$(cd "$repo" && CORTEX_PROFILE=lab node "$PF" 2>&1)"
assert_contains "$out" "sealed" "lab refuses nothing locally and therefore publishes nothing"

out="$(cd "$repo" && env -u CORTEX_PROFILE node "$PF" 2>&1)"
assert_contains "$out" "home (default)" "an undeclared machine defaults to home — the strict direction"

# A typo must not resolve to a working profile. `CORTEX_PROFILE=works` silently becoming `home` would
# look identical to a correct home install while the user believed the firewall pointed elsewhere.
assert_exit 2 "an unrecognised CORTEX_PROFILE fails loudly rather than falling back" \
  -- env -C "$repo" CORTEX_PROFILE=works node "$PF"

# --- it writes nothing --------------------------------------------------------------------------------
#
# Asserted on the whole tree rather than on one expected artefact: a test naming the symptom it
# thought of passes for every other way of failing (docs/changing-cortex.md).
before="$(cd "$repo" && git status --porcelain; find "$repo" -type f | sort)"
(cd "$repo" && node "$PF" tracked.md >/dev/null 2>&1) || true
after="$(cd "$repo" && git status --porcelain; find "$repo" -type f | sort)"
assert_eq "$before" "$after" "a preflight leaves the tree byte-identical"

# --- outside a repo it says so rather than guessing ------------------------------------------------------
bare="$work/notarepo"
mkdir -p "$bare"
out="$(cd "$bare" && node "$PF" 2>&1)"
assert_contains "$out" "not a git repo" "outside a repo it names cwd as a fallback instead of inventing a root"

rm -rf "$work"
