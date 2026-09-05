# An allow-secrets exemption must be earning its keep.
#
# A file opts out of the secrets finding with a marker comment, and `index/lib/findings.mjs` then
# lists it under "these carry a marker, worth re-reading occasionally". That periodic re-read is the
# only control on an exemption — the marker is a claim by whoever added it, not a guarantee.
#
# The re-read has a hole. The finding is built from files that HAVE secret-shaped hits, so a file
# whose fixtures stopped matching the scanner keeps a blanket exemption that never appears in any
# report. tools/test/cortex-cron.test.sh sat that way: its fake key began with "test", `core/scrub.js`
# added "test" to PLACEHOLDER, the hits went to zero, and the marker stayed — covering the whole file
# against any real credential a later edit might add, invisibly.
#
# So: an exemption with nothing to exempt is deleted, not kept for a rainy day. The scan reporting
# "clean" is the truth, and a marker suppresses it.
#
# This file names the marker by concatenation on purpose. Written out, it would exempt this test
# from the rule the test enforces — the same self-matching trap no-private-names.test.sh fell into.

cd "$REPO_ROOT" || exit 1

MARKER="cortex:""allow-secrets"

# Only a marker in the file's HEADER is a claim about that file. Further down it is prose about the
# mechanism — core/AGENTS.md explains it, index/lib/findings.mjs implements it in `markerLine`, and
# index/test/findings.test.mjs builds it into a fixture. Those three would be judged exempt by a bare
# `includes`; harmless, because none of them holds a secret-shaped string. Judging them here would
# report five permanent failures nobody can fix, and a check that always fails is a check people
# learn to ignore.
#
# Named, not numbered, on purpose: the first version of this comment cited findings.mjs:196, which
# was true when written and became line 218 the same day, when an unrelated finding was edited above
# it. A line number in a durable comment has a half-life of one edit anywhere above the thing it
# points at. `markerLine` survives that, and a rename is loud where a shifted line is silent.
HEADER_LINES=10

marked=""
for f in $(git grep -lF "$MARKER" -- . || true); do
  if head -n "$HEADER_LINES" "$f" | grep -qF "$MARKER"; then
    marked="$marked$f
"
  fi
done
marked="$(printf '%s' "$marked" | grep -v '^$' || true)"

if [ -z "$marked" ]; then
  _pass "no file claims a secrets exemption"
  return 0 2>/dev/null || exit 0
fi

# One node process for all of them: importing core/scrub.js per file is the slow path.
report="$(printf '%s\n' "$marked" | node -e '
const { readFileSync } = require("node:fs");
import("./core/scrub.js").then(({ scan }) => {
  const files = readFileSync(0, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  for (const f of files) {
    let hits = [];
    try { hits = scan(readFileSync(f, "utf8")); } catch { continue; }
    console.log(`${hits.length}\t${f}`);
  }
});' 2>&1)"

dormant="$(printf '%s\n' "$report" | awk -F'\t' '$1 == 0 { print $2 }')"

if [ -z "$dormant" ]; then
  _pass "every allow-secrets marker sits on a file that actually scans dirty"
else
  _fail "every allow-secrets marker sits on a file that actually scans dirty" \
    "$(printf 'these carry a marker but scan to zero hits — delete the marker:\n%s\n' "$dormant")"
fi

# The scanner's own corpus is the case that must never go dormant unnoticed: if core/test/scrub.test.js
# stops matching, the scanner has stopped detecting what it is built to detect.
corpus="$(printf '%s\n' "$report" | awk -F'\t' '$2 == "core/test/scrub.test.js" { print $1 }')"
if [ "${corpus:-0}" -gt 0 ]; then
  _pass "the scanner's own corpus still scans dirty ($corpus hits)"
else
  _fail "the scanner's own corpus still scans dirty" "core/test/scrub.test.js matched nothing"
fi
