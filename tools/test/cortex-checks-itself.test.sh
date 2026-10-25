# Cortex indexes and reports on itself, and the report has no critical finding and no import cycle.
#
# Run over this repository, Cortex found four defects in its own code that no test had caught: a
# critical secrets heading that counted 4 files above a list of 11, three tracker modules flagged
# for a constant holding environment-variable names, fixtures ranked as the busiest untested code,
# and `mcp/lib/asks.js` and `mcp/lib/sync.js` importing each other. A critical finding is the first
# thing /cortex asks a user about (ADR 0006), and a cycle inside a package is the coupling the
# layering test exists to stop, so either one here fails the build.
#
# The index is built from a clean clone in $WORK, so the checkout gets no `.cortex/`. The clone is of
# the last commit: a change still in the working tree is checked once it is committed.
#
# The fix for a red run is the repo, never the checker. Loosening a finding to make this pass would
# loosen it for every user too.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

cd "$WORK" || exit 1

cat > "$WORK/self-check.mjs" <<'NODE'
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [target, findingsJson] = process.argv.slice(2);
const index = JSON.parse(readFileSync(join(target, ".cortex/index/index.json"), "utf8"));
const findings = JSON.parse(readFileSync(findingsJson, "utf8"));
const list = Array.isArray(findings) ? findings : findings.findings;
console.log(`files ${index.files.length}`);
for (const f of list) if (f.severity === "critical") console.log(`CRITICAL ${f.title}\n  ${f.evidence.join("\n  ")}`);
for (const p of (index.cycles ?? []).flat()) if (/^(core|index|mcp)\//.test(p)) console.log(`CYCLE ${p}`);
NODE

# One function so the planted run below goes through exactly what the real run does.
check() { # dir → prints the self-check's lines; returns non-zero when a step crashed
  node "$REPO_ROOT/index/cortex-index.mjs" "$1" >/dev/null 2>&1 || return 1
  node "$REPO_ROOT/index/cortex-findings.mjs" "$1" --json >"$WORK/findings.json" 2>/dev/null || return 1
  node "$WORK/self-check.mjs" "$1" "$WORK/findings.json"
}

before="$(git -C "$REPO_ROOT" status --porcelain --ignored)"
git clone -q "$REPO_ROOT" "$WORK/self"
out="$(check "$WORK/self" 2>&1)"; rc=$?
assert_eq "0" "$rc" "Cortex indexes and reports on a clone of itself"

# An index that saw almost nothing would pass by checking nothing.
seen="$(printf '%s\n' "$out" | sed -n 's/^files //p')"
if [ "${seen:-0}" -ge 300 ]; then
  _pass "the index walked the repository ($seen files)"
else
  _fail "the index walked the repository" "saw ${seen:-none} files — an empty walk would pass for the wrong reason"
fi

if grep -q '^CRITICAL ' <<<"$out"; then
  _fail "Cortex's report on itself has no critical finding" "$(grep -A20 '^CRITICAL ' <<<"$out")"
else
  _pass "Cortex's report on itself has no critical finding"
fi

if grep -q '^CYCLE ' <<<"$out"; then
  _fail "no import cycle inside core/, index/ or mcp/" "$(grep '^CYCLE ' <<<"$out")"
else
  _pass "no import cycle inside core/, index/ or mcp/"
fi

assert_eq "$before" "$(git -C "$REPO_ROOT" status --porcelain --ignored)" "the run wrote nothing into the checkout"

# And it can fail: a secret in product code and a cycle in mcp/lib, planted in a second clone. The
# key is assembled so this file holds no secret-shaped literal of its own.
git clone -q "$REPO_ROOT" "$WORK/planted"
key="$(printf '%s%s%s' "AKIA" "IOSFODNN7" "EXAMPLE")"
printf 'export const KEY = "%s";\n' "$key" >"$WORK/planted/core/planted-key.js"
printf 'import "./planted-b.js";\n' >"$WORK/planted/mcp/lib/planted-a.js"
printf 'import "./planted-a.js";\n' >"$WORK/planted/mcp/lib/planted-b.js"
git -C "$WORK/planted" -c core.autocrlf=false add -A
git -C "$WORK/planted" -c user.email=test@cortex.local -c user.name="Cortex Test" commit -q -m planted
planted="$(check "$WORK/planted" 2>&1)"
assert_contains "$planted" "core/planted-key.js" "a planted secret in product code is a critical finding"
assert_contains "$planted" "CYCLE mcp/lib/planted-a.js" "a planted cycle in mcp/lib is reported"
