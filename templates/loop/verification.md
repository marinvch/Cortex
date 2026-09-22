<!-- Appended to the target repo's CLAUDE.md by /cortex.
     Every {{PLACEHOLDER}} is a command cortex-loop.mjs DETECTED. One it did not detect is a
     question for the user, never a blank to fill with a guess — an instruction that fails on its
     first run is how a context file loses its reader. Delete any line whose command does not exist. -->

## Verifying your work

| Check | Command | A healthy run |
|---|---|---|
| Build | `{{BUILD}}` | {{BUILD_OK}} |
| Test | `{{TEST}}` | every test passes; none skipped to get there |
| Lint | `{{LINT}}` | no warnings |

"Done" means these ran and passed in this session, with their output shown — not that the edit
was made. A red test is information about the code; change the code until it is green, and leave
the test alone unless the task is explicitly to change what it asserts.
