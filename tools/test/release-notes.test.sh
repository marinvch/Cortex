# tools/cortex-release-notes.mjs — one version's section of the changelog, or a refusal.
#
# A release's notes are that version's section of CHANGELOG.md. Cut by hand, the section is copied
# between two headings, and the failure nobody sees is a heading that is slightly wrong: the copy
# then runs on into the version below it, or stops short, and the release says something the
# changelog does not. Each case below is one way the section can be the wrong text, and each must
# exit non-zero and print nothing on stdout, so a caller that pipes the output cannot publish it.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

TOOL="$REPO_ROOT/tools/cortex-release-notes.mjs"
cd "$WORK" || exit 1

# notes <changelog> <version> — stdout in $out, stderr in $err, exit code in $rc.
notes() {
  out="$(node "$TOOL" "$2" --changelog "$1" 2>stderr.txt)"
  rc=$?
  err="$(cat stderr.txt)"
}

cat > good.md <<'EOF'
# Changelog

Notes about the format.

## [Unreleased]

## [2.41.10] — 2026-10-03

The tenth.

### Added

- **A thing.** It does something
  over two lines.

## [2.41.9] — 2026-10-02

The ninth.

````markdown` is how a quoted block is written in this sentence, and it opens no fence.

### Fixed

- A fix.


## [1.0.0] — 2026-01-01

The first.

[2.41.10]: https://example.com/releases/tag/v2.41.10
[1.0.0]: https://example.com/releases/tag/v1.0.0
EOF

notes good.md 2.41.10
assert_eq "0" "$rc" "a section between two version headings is extracted"
assert_eq "$(printf 'The tenth.\n\n### Added\n\n- **A thing.** It does something\n  over two lines.')" "$out" "as its body alone: no heading, no blank lines around it"
assert_eq "" "$err" "and nothing on stderr"

notes good.md v2.41.10
assert_eq "0" "$rc" "a tag name is accepted for the version"
assert_contains "$out" "The tenth." "and names the same section"

notes good.md 2.41.9
assert_eq "0" "$rc" "2.41.10 above 2.41.9 is in order: versions compare as numbers"
assert_contains "$out" "- A fix." "and the section runs to its last line"
assert_not_contains "$out" "The first." "and stops at the next version heading"
assert_contains "$out" "opens no fence" "a prose line that starts with backticks does not hide the heading after it"

notes good.md 1.0.0
assert_eq "0" "$rc" "the oldest section ends at the end of the file"
assert_eq "The first." "$out" "without the link definitions that close the file"

printf '%s' "$(cat good.md)" | sed 's/$/\r/' > crlf.md
notes crlf.md 2.41.10
assert_eq "$(printf 'The tenth.\n\n### Added\n\n- **A thing.** It does something\n  over two lines.')" "$out" "a CRLF changelog gives the same text with LF endings"

# --- refusals ---------------------------------------------------------------------------------------

notes good.md 2.41.11
assert_eq "1" "$rc" "a version with no section is refused"
assert_eq "" "$out" "and nothing is printed to publish"
assert_contains "$err" "no section for 2.41.11" "and the reason is one line"

sed 's/^The tenth\.$//; /^### Added$/,/over two lines\.$/d' good.md > empty.md
notes empty.md 2.41.10
assert_eq "1" "$rc" "an empty section is refused"
assert_contains "$err" "is empty" "and says so"

# The heading below is wrong in a way a reader does not see, and the section above would swallow it.
sed 's/^## \[2\.41\.9\] — 2026-10-02$/## 2.41.9 — 2026-10-02/' good.md > nobrackets.md
notes nobrackets.md 2.41.10
assert_eq "1" "$rc" "a next heading with no brackets is refused"
assert_contains "$err" "line 16" "and the line is named"

sed 's/^## \[2\.41\.9\] — 2026-10-02$/### [2.41.9] — 2026-10-02/' good.md > h3.md
notes h3.md 2.41.10
assert_eq "1" "$rc" "a version heading at the wrong level is refused, not published inside the section above"
assert_eq "" "$out" "and nothing is printed"

sed 's/^## \[2\.41\.9\] — 2026-10-02$/## [2.41.9]/' good.md > nodate.md
notes nodate.md 2.41.10
assert_eq "1" "$rc" "a next heading with no date is refused"

sed 's/^## \[2\.41\.9\] — 2026-10-02$/##[2.41.9] — 2026-10-02/' good.md > nospace.md
notes nospace.md 2.41.10
assert_eq "1" "$rc" "a next heading markdown does not read as a heading is refused"

sed 's/^## \[2\.41\.9\] — 2026-10-02$/## [Unreleased]/' good.md > unreleased.md
notes unreleased.md 2.41.10
assert_eq "1" "$rc" "a section that ends at a heading that is not a version is refused"

notes nodate.md 2.41.9
assert_eq "1" "$rc" "asking for the version whose own heading is malformed is refused"
assert_contains "$err" "line 16" "and points at the heading that is nearly right"

sed 's/^## \[2\.41\.9\] — 2026-10-02$/## [2.41.11] — 2026-10-02/' good.md > order.md
notes order.md 2.41.10
assert_eq "1" "$rc" "a next version that is not lower is refused: a section is missing or misplaced"

sed 's/^## \[2\.41\.9\] — 2026-10-02$/## [2.41.10] — 2026-10-02/' good.md > twice.md
notes twice.md 2.41.10
assert_eq "1" "$rc" "a version with two sections is refused"
assert_contains "$err" "twice" "and says why"

# --- usage ------------------------------------------------------------------------------------------

out="$(node "$TOOL" --changelog good.md 2>&1)"; rc=$?
assert_eq "2" "$rc" "no version is a usage error, on its own exit code"
notes good.md 2.41
assert_eq "2" "$rc" "so is a version that is not x.y.z"
notes missing.md 2.41.10
assert_eq "2" "$rc" "and a changelog that cannot be read"

# --- this repository --------------------------------------------------------------------------------
#
# The version stamped on this checkout is the next one released. If its notes cannot be extracted,
# that is found here and not while cutting the release.

out="$(cd "$REPO_ROOT" && node "$TOOL" "$(cat VERSION)" 2>&1)"; rc=$?
assert_eq "0" "$rc" "the version this checkout is stamped with has notes that extract"
assert_eq "0" "$(echo "$out" | grep -c '^## ')" "and no line of them is a second-level heading"
