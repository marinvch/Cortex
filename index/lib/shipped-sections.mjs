// shipped-sections.mjs — every text an earlier release wrote as a section of a shared file (#505).
//
// A section Cortex appends to `CLAUDE.md` is not in the stamp record: the record hashes whole files,
// and the team writes the rest of this one. Without a record, the only honest way to tell "Cortex's
// old text, untouched" from "the team changed it" is to know every text Cortex ever shipped there.
// They are kept here, verbatim, each with the hash of its text under the record's rule
// (`hashText`: CRLF is LF, trailing newlines dropped). A section that matches one of them, with any
// values in its placeholders, is `outdated`; one that matches none is the team's.
//
// `current` pins this release's template. `section.test.mjs` fails when the template changes and
// this does not, with the instruction: if the text being replaced was ever released, add it to
// `earlier` first. Forgetting that is not unsafe — every repo stamped by that release reads
// `edited` and is never overwritten — but it strands those repos on the old text with nothing
// offering them the new one, which is the bug this file exists to end.
//
// Data only: no filesystem, no clock.

const lines = (...l) => l.join("\n");

export const SHIPPED_SECTIONS = {
  "team/playbook.md": {
    current: "77ecfa440a1213b3dd17f5efa3d4b42ccaf988422b31025f5bb8644f2b5be430",
    earlier: [
      {
        // The playbook that asked in its own words, and gave way to "just do it" (#498).
        version: "2.41.0",
        sha256: "5c3bd3c004c71f4243ee47a15cedd5b7733134c6de044b52ee120a69cf0e1a45",
        text: lines(
          "## Working as a team",
          "",
          "This repo has single-job agents in `.claude/agents/`: {{ROSTER}}. This session runs them.",
          "",
          "For each new task that changes code:",
          "",
          "1. Run `/cortex-impact --size` on the files the task will touch. It recommends single or team,",
          "   with its reasons.",
          "2. Give the developer that recommendation and its reasons, and ask the developer which to use.",
          "   The developer decides.",
          "3. On \"single\", work as usual. On \"team\", load the `team` skill and follow it: a plan, at most two",
          "   rounds of cited objections, then a failing test, the change and an independent review.",
          "",
          "To stop using the team, delete this section, `.claude/skills/team/` and the agents.",
        ),
      },
    ],
  },
};

// Sections Cortex writes and cannot track. `CLAUDE.md` § Verifying your work is filled partly by
// hand — rows deleted where a command does not exist, the opening comment left out — so no match
// can tell Cortex's text from the team's, and a change to its template would reach new installs and
// no repo already holding the block. Its hash is pinned so that change cannot happen unnoticed:
// `section.test.mjs` fails until it is either given a refresh path or declared not to need one.
export const UNTRACKED_SECTIONS = {
  "loop/verification.md": {
    heading: "Verifying your work",
    sha256: "321577db007e1bc20b38a8e494398f7259a18395b1a11aeab50a372742bb1698",
  },
};
