# templates/vault/ is the empty vault /onboard and cortex-vault-extract.sh copy from.
#
# Until 2.39 the skeleton was spread across this repo's root — connections.md, references/voice.md
# and eight folder placeholders re-included by `!` lines in .gitignore — so the product root read as
# a vault, and /onboard filled a tracked file in place. The skeleton now lives in one folder, and
# the root's vault folder names stay ignored only as a backstop.
#
# Two ways this rots silently: a rule rewritten to match at any depth (`**/inbox/*`, or `inbox/`
# with no inner slash) swallows templates/vault/inbox/ and skills/daily/, so a new file there can
# never be added; or a skeleton file drifts back to the root and ships as product.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

cd "$REPO_ROOT" || exit 1

SKELETON=(connections.md references/voice.md inbox/README.md daily/README.md notes/README.md
  projects/README.md areas/README.md resources/README.md context/.gitkeep decisions/.gitkeep)

for f in "${SKELETON[@]}"; do
  p="templates/vault/$f"
  if [ -n "$(git ls-files -- "$p")" ]; then _pass "skeleton $p is tracked"; else _fail "skeleton $p is tracked" "not in git ls-files"; fi
  # --no-index asks the rules, not the index: a tracked file is never reported as ignored otherwise.
  if git check-ignore -q --no-index "$p"; then
    _fail "skeleton $p is not ignored" "a .gitignore rule matches it — a new file beside it could not be added"
  else
    _pass "skeleton $p is not ignored"
  fi
done

# Nothing of the vault is tracked at the product root any more.
root_vault="$(git ls-files -- connections.md references/voice.md inbox daily notes projects areas resources context decisions)"
assert_eq "" "$root_vault" "no vault file is tracked at the product root"

# The backstop: a vault folder left at the root of a checkout is still ignored.
for p in inbox/x.md daily/2026-01-01.md notes/n.md projects/p.md areas/a.md resources/r.md context/about-me.md decisions/log.md; do
  if git check-ignore -q --no-index "$p"; then _pass "root $p is ignored"; else _fail "root $p is ignored" "a personal file at the root is committable"; fi
done

# The backstop is anchored to the root: it must never swallow a product folder that shares a name.
if git check-ignore -q --no-index skills/daily/NEW.md; then
  _fail "skills/daily/ is not caught by the vault's daily/ rule" "an unanchored rule matches it"
else
  _pass "skills/daily/ is not caught by the vault's daily/ rule"
fi
