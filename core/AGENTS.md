# core/ — the shared kernel

Four modules that both `index/` and `mcp/` depend on. Everything security-critical in Cortex lives
here, which is why the directory is small and stays small.

## Invariants

- **`core/` imports nothing else in this repo.** Not `index/`, not `mcp/`. Enforced by
  `test/architecture.test.js`; if you need something from a leaf, the dependency is backwards.
- **Every caller-supplied path goes through `resolveInRoot`.** It realpaths the nearest *existing*
  ancestor, so a symlink escape is caught even for a file that does not exist yet. `projects.js`
  once skipped this and `getProjectContext(root, "../../secret")` read any file on disk.
- **`scrub.js` refuses; it never sanitises.** `assertWritable` throws `RefusedWriteError` and the
  write does not happen. Silently rewriting a developer's note to remove a secret is a worse
  failure than declining it with a reason.
- **No error message may echo a secret.** `redact()` exists for this; `RefusedWriteError` names
  the *kind* of secret and its line, never the value.
- **Memory is append-only.** `append()` never rewrites an existing entry. Two developers writing
  on the same day append to one file and git merges it as text; there is no lost-update case, and
  introducing one would break the whole shared-memory model.

## Gotchas

- `stamp()` is re-exported from `memory.js` for convenience, but `date.js` **owns** it. There was
  briefly a second copy after the kernel extraction; do not add a third.
- `paths.test.js` skips its symlink case on Windows — creating a symlink there needs admin. The
  skip is expected in local runs and in the Windows CI leg.
- `scrub.test.js` carries a `cortex:allow-secrets` marker. Without it, Cortex reports its own test
  corpus as a critical finding on every run. If you add a new detector, add its fixture *there*,
  assembled at runtime — a realistic literal trips GitHub push protection and blocks the push.

## Tests

```bash
node --test core/test/*.test.js
```

`architecture.test.js` and `plugin.test.js` are drift guards rather than unit tests: they fail when
the layering or the plugin packaging rots, which no application test would notice.
