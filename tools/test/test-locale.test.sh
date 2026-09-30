# The runner pins the C locale, so a sorted list compares the same on every machine (#509).
#
# Under a glibc UTF-8 locale `sort` collates with the leading dot ignored: `bands.yaml` came before
# `.claude/…`, and cortex-stamps.test.sh failed on a Raspberry Pi while CI, which runs in C, passed.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

assert_eq "C" "${LC_ALL:-}" "run.sh exports LC_ALL=C to every test"
assert_eq ".claude/x bands.yaml " "$(printf 'bands.yaml\n.claude/x\n' | sort | tr '\n' ' ')" "a bare sort puts a dotfile first"
