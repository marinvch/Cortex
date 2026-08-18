# 0010. The shell half gets the root guard too

**Date:** 2026-08-18
**Status:** accepted

## Context

ADR 0007 made `mcp/lib/vault.js` the only door onto a vault root, enforced by a test, because a
caller-supplied path that escapes the root can read or write anything on disk. That ADR was about
the Node half. **The bash tools never got the same treatment.**

`tools/cortex-rm.sh` did:

```bash
ROOT="$(pwd)"; F="${1:-}"
[ -f "$ROOT/$F" ] || { echo "not found: $F"; exit 1; }
mv "$ROOT/$F" "archives/removed/..."
```

Which produced, verified rather than theorised:

```
$ cd vault && bash tools/cortex-rm.sh ../outside/secret.md
✓ archived → archives/removed/secret.20260818-134621.md
```

A file outside the vault, moved into the vault's archive.

This is not remote-exploitable — it is a local CLI invoked with a path a person typed. It was worth
fixing for two reasons that have nothing to do with exploitability.

**The tool cannot keep its own promise.** `cortex-rm.sh` says *archive, don't delete* and prints
"Recover from `archives/removed/`". For a file dragged in from outside the vault, the original
location is gone from the record — there is nothing to recover it *to*. The safety story only holds
inside the root it assumes.

**An agent may construct the path.** Cortex is a tool agents drive. "A person would not type that" is
not a property of this codebase, and it is precisely the assumption ADR 0007 exists to remove.

## Decision

`resolve_in_root <root> <path>` lands in **`tools/_cortex-lib.sh`**, the shared library the
vault-root tools already source, and `cortex-rm.sh` routes its target through it.

**In the shared lib, not in `cortex-rm.sh`.** The next destructive tool should inherit the guard
rather than re-derive it. "Five modules each had to remember to call the guard" is the exact failure
ADR 0007 was written about, and repeating it one directory over would be a poor way to honour that
ADR.

**`cd` + `pwd -P`, not `realpath`.** `realpath` is not present on macOS by default, and ADR 0004
keeps this repo dependency-free. `pwd -P` is POSIX and resolves symlinks. It walks up to the deepest
*existing* ancestor first, so a target that does not exist yet still resolves — the guard runs before
a create, not only before a read.

**Not a string-prefix check.** `<root>/link/x`, where `link` is a symlink pointing outside, passes
any prefix comparison and is still an escape. This is the same reason `core/paths.js` realpaths the
nearest existing ancestor instead of comparing strings.

## Alternatives rejected

**Guard only `cortex-rm.sh`.** The smallest possible change, and it recreates the state ADR 0007
diagnosed: a correct guard that each caller may or may not remember to use.

**Treat it as acceptable because the tool is local.** Rejected on the tool's own terms — it promises
recoverability it cannot deliver outside the root — and because agents construct paths.

**Retrofit the guard into every `tools/*.sh`.** Two were checked and do not need it:
`cortex-vault-extract.sh` resolves its root from the script's own location, and
`cortex-scan-projects.sh` only removes inside `$VAULT/projects/` under a slugified name, which cannot
express a traversal segment. Adding a guard where there is no door is noise, and noise is how a real
guard stops being noticed.

## Consequences

`_cortex-lib.sh` now carries a security primitive alongside its formatting helpers. That is the right
home — it is what the vault-root tools already source — but it means the file's own tests matter more
than they did.

Six promises of `cortex-rm.sh` are now pinned that never were: the note is moved rather than deleted,
`[[slug|alias]]` becomes the alias, a bare `[[slug]]` becomes plain text, `archives/` is not
rewritten, and **an unrelated link in the same file survives**. That last one guards the de-link pass,
which `sed -i`s every note containing the slug — a greedy pattern would quietly damage the whole
vault, and two links in two files would not catch it.

The symlink test **probes `test -L` rather than `ln`'s exit status**. On Git Bash without
`winsymlinks`, `ln -s` succeeds and silently makes a copy; the "link" is then a real directory inside
the root, and accepting it is correct because there is no escape on disk to refuse. This is the
second time this session a capability had to be probed by its result rather than its command's exit
code — the first was `chmod`/`umask` for the `0600` env file. Worth treating as the default habit in
shell tests, not a special case.
