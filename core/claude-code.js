// core/claude-code.js — what Anthropic's Claude Code docs say, as data Cortex can check against.
//
// Licence note: every `evidence` string below is a short quotation from Anthropic's documentation,
// © Anthropic, reproduced so a reader can verify the rule against its cited page. The quotations
// are not licensed under this repository's MIT licence; the code and the rest of this file are.
// THIRD_PARTY_NOTICES.md says the same.
//
// The `model.*` rules come from the platform docs instead: how the model itself behaves, which is
// what a direct Messages API caller or an unattended runner has to assume.
//
// Every rule carries the page it came from, the sentence on that page that states it — copied, not
// paraphrased — and the date someone last confirmed the sentence was still there. Nothing here
// fetches anything: users get these rules with the plugin, the same on every machine and offline.
// Keeping them true is the maintainer's job, and `tools/cortex-claude-docs.mjs --check` is how —
// it fails when a rule's evidence has left its page. ADR 0017 holds the reasoning.
//
// Pure data, two lookups, one heuristic two readers share (`triggerPhrasing`), and one path test
// the loop reader applies to what /setup-repo would write (`protectedClaudePath`). It lives in
// core/ because both index/'s findings and the tools/ that check Cortex's own files consume it,
// and core/ is the one place both may import.
//
// Adding a rule: fetch the page (`<source>.md` serves the markdown), copy the sentence that states
// the rule into `evidence` exactly as the page has it — link text without the URL is fine — and run
// the check. If no sentence states it, the rule does not belong here: an unsourced rule is an
// opinion, and the point of this file is that none of it is.

/** The date every rule below was last confirmed against its page. */
export const CHECKED = "2026-10-28";

const SKILLS = "https://code.claude.com/docs/en/skills";
const SUBAGENTS = "https://code.claude.com/docs/en/sub-agents";
const MCP = "https://code.claude.com/docs/en/mcp";
const HOOKS = "https://code.claude.com/docs/en/hooks";
const HOOKS_GUIDE = "https://code.claude.com/docs/en/hooks-guide";
const MEMORY = "https://code.claude.com/docs/en/memory";
const BEST = "https://code.claude.com/docs/en/best-practices";
const SETTINGS = "https://code.claude.com/docs/en/settings";
const PERMISSIONS = "https://code.claude.com/docs/en/permissions";
const MODES = "https://code.claude.com/docs/en/permission-modes";
const HEADLESS = "https://code.claude.com/docs/en/headless";
const AUTHORING = "https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices";
const PLUGINS_REF = "https://code.claude.com/docs/en/plugins-reference";
const MARKETPLACES = "https://code.claude.com/docs/en/plugin-marketplaces";
const REVIEW_CUSTOMIZE = "https://code.claude.com/docs/en/code-review-customize";
const REVIEW_PRS = "https://code.claude.com/docs/en/code-review-pull-requests";
const REVIEW_LOCAL = "https://code.claude.com/docs/en/code-review-local";
const TEAMS = "https://code.claude.com/docs/en/agent-teams";
const WORKTREES = "https://code.claude.com/docs/en/worktrees";
const MANIFEST = "https://code.claude.com/docs/en/plugins/manifest-reference";
const MARKETPLACE_REF = "https://code.claude.com/docs/en/plugins/marketplace-reference";
const COMPONENTS = "https://code.claude.com/docs/en/plugins/components";
const LOADING = "https://code.claude.com/docs/en/plugins/loading";
const MODS = "https://code.claude.com/docs/en/plugins/mods/overview";
const MODS_REF = "https://code.claude.com/docs/en/plugins/mods/reference";
const MODS_ADMIN = "https://code.claude.com/docs/en/plugins/mods/admin";
const OPUS_5_5 =
  "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5";

/**
 * `table: "frontmatter"` marks a rule whose value is a key list read from the page's frontmatter
 * reference table — the check confirms every listed key is still a row there, and reports rows it
 * does not know as new (informational: a new key breaks nothing, it is just unused).
 */
export const RULES = Object.freeze([
  // --- skills ------------------------------------------------------------------------------------
  {
    id: "skill.frontmatter.keys",
    value: [
      "name", "description", "when_to_use", "argument-hint", "arguments",
      "disable-model-invocation", "user-invocable", "allowed-tools", "disallowed-tools", "model",
      "effort", "context", "agent", "background", "hooks", "paths", "shell", "metadata", "license",
      "compatibility",
    ],
    table: "frontmatter",
    source: SKILLS,
    evidence:
      "A field name must match the table exactly, hyphens included: Claude Code ignores a field it doesn't recognize without reporting an error.",
  },
  {
    id: "skill.metadata.custom-keys",
    value: "metadata",
    source: SKILLS,
    evidence:
      "Free-form YAML map for your own key-value data, such as entitlement or catalog fields, read by your own tooling from `SKILL.md`.",
  },
  {
    id: "skill.description.max-chars",
    value: 1536,
    source: SKILLS,
    evidence:
      "Put the key use case first: the combined `description` and `when_to_use` text is truncated at 1,536 characters in the skill listing to reduce context usage.",
  },
  {
    id: "skill.body.max-lines",
    value: 500,
    source: SKILLS,
    evidence: "Keep `SKILL.md` under 500 lines. Move detailed reference material to separate files.",
  },
  {
    id: "skill.disable-model-invocation",
    value: true,
    source: SKILLS,
    evidence:
      "Set to `true` to prevent Claude from automatically loading this skill. Use for workflows you want to trigger manually with `/name`.",
  },
  {
    id: "skill.supporting-files.referenced",
    value: true,
    source: SKILLS,
    evidence:
      "Reference supporting files from `SKILL.md` so Claude knows what each file contains and when to load it",
  },
  {
    id: "skill.frontmatter.malformed",
    value: "empty metadata",
    source: SKILLS,
    evidence:
      "If the frontmatter YAML is malformed, Claude Code loads the skill body with empty metadata, so `/skill-name` still works but Claude can't match against your `description`.",
  },
  {
    id: "skill.frontmatter.first-line",
    value: "---",
    source: SKILLS,
    evidence: "Claude Code reads the frontmatter only when the opening `---` is the file's first line.",
  },
  {
    id: "skill.metadata.must-be-map",
    value: "map",
    source: SKILLS,
    evidence: "Claude Code doesn't act on its contents, and drops a value that isn't a map.",
  },
  {
    id: "skill.name.reserved-namespace",
    value: "anthropic-skills",
    source: SKILLS,
    evidence:
      "Claude Code reserves the name `anthropic-skills`, and every name inside that namespace such as `anthropic-skills:pdf`, for skills synced from claude.ai, so a synced skill's full name never runs anything else.",
  },
  {
    id: "skill.frontmatter.portable-keys",
    value: ["name", "description", "license", "compatibility", "metadata", "allowed-tools"],
    source: SKILLS,
    evidence:
      "claude.ai skill uploads, the Skills API, and packaging with `package_skill.py` from anthropics/skills | `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`",
  },
  {
    id: "skill.listing.budget-fraction",
    value: 0.01,
    source: SKILLS,
    evidence: "The budget scales at 1% of the model's context window.",
  },
  {
    id: "skill.compaction.kept-tokens",
    value: 5000,
    source: SKILLS,
    evidence:
      "When the conversation is summarized to free context, Claude Code re-attaches the most recent invocation of each skill after the summary, keeping the first 5,000 tokens of each.",
  },
  {
    id: "skill.compaction.shared-budget-tokens",
    value: 25000,
    source: SKILLS,
    evidence: "Re-attached skills share a combined budget of 25,000 tokens.",
  },
  {
    id: "skill.allowed-tools.ignores-workspace-trust",
    value: "allowed-tools",
    source: SKILLS,
    evidence:
      "Claude Code applies a project skill's `allowed-tools` even in a `-p` run in a folder you've never trusted.",
  },

  // --- skills: the Agent Skills format, from the platform's authoring page ------------------------
  //
  // These are limits of the format a skill is uploaded in (the API, claude.ai), not of Claude Code,
  // which loads a skill that breaks them. So they are a second, lower bar: what a skill has to meet
  // to be moved between the two. The description limit is the clearest case. Claude Code truncates
  // at 1,536 characters (`skill.description.max-chars`); the format stops at 1,024.
  {
    id: "skill.name.max-chars",
    value: 64,
    source: AUTHORING,
    evidence: "Maximum 64 characters",
  },
  {
    id: "skill.name.charset",
    value: "lowercase letters, numbers and hyphens",
    source: AUTHORING,
    evidence: "Must contain only lowercase letters, numbers, and hyphens",
  },
  {
    id: "skill.name.reserved-words",
    value: ["anthropic", "claude"],
    source: AUTHORING,
    evidence: "Cannot contain reserved words: `anthropic`, `claude`",
  },
  {
    id: "skill.description.portable-max-chars",
    value: 1024,
    source: AUTHORING,
    evidence: "Maximum 1,024 characters",
  },
  {
    id: "skill.reference.contents-over-lines",
    value: 100,
    source: AUTHORING,
    evidence: "For reference files longer than 100 lines, include a table of contents at the top.",
  },

  // --- subagents ---------------------------------------------------------------------------------
  {
    id: "subagent.frontmatter.keys",
    value: [
      "name", "description", "tools", "disallowedTools", "model", "permissionMode", "maxTurns",
      "skills", "mcpServers", "hooks", "memory", "background", "omitClaudeMd", "effort",
      "isolation", "color", "initialPrompt", "experimental", "autoCompactWindow",
    ],
    table: "frontmatter",
    source: SUBAGENTS,
    evidence:
      "Multi-word field names use camelCase, such as `maxTurns` and `disallowedTools`, and must match the table exactly: Claude Code ignores a field it doesn't recognize without reporting an error.",
  },
  {
    id: "subagent.frontmatter.required",
    value: ["name", "description"],
    source: SUBAGENTS,
    evidence: "Only `name` and `description` are required.",
  },
  {
    id: "subagent.tools.inherit-when-omitted",
    value: "tools",
    source: SUBAGENTS,
    evidence: "Inherits every tool available to subagents if omitted.",
  },
  {
    id: "subagent.frontmatter.malformed",
    value: "skipped",
    source: SUBAGENTS,
    evidence:
      "YAML that doesn't parse: Claude Code reads no fields from the file, skips it, and writes the parse error to the debug log.",
  },
  {
    id: "subagent.plugin.ignored-keys",
    value: ["hooks", "mcpServers", "permissionMode"],
    source: SUBAGENTS,
    evidence:
      "For security reasons, plugin subagents don't support the `hooks`, `mcpServers`, or `permissionMode` frontmatter fields. These fields are ignored when loading agents from a plugin.",
  },
  {
    id: "subagent.name.no-colon",
    value: ":",
    source: SUBAGENTS,
    evidence:
      "Names can't contain `:`, which is reserved for plugin-scoped identifiers such as `my-plugin:reviewer`",
  },
  {
    id: "subagent.descriptions.max-tokens",
    value: 15000,
    source: SUBAGENTS,
    evidence:
      "When the combined descriptions of your subagents, except the built-in ones, exceed 15,000 tokens, Claude Code shows a warning at startup with the total token count.",
  },

  // --- MCP ---------------------------------------------------------------------------------------
  {
    id: "mcp.output.warn-tokens",
    value: 10000,
    source: MCP,
    evidence: "Claude Code displays a warning when any MCP tool output exceeds 10,000 tokens",
  },
  {
    id: "mcp.output.max-tokens",
    value: 25000,
    source: MCP,
    evidence: "the default maximum is 25,000 tokens",
  },
  {
    id: "mcp.output.max-result-chars",
    value: 500000,
    source: MCP,
    evidence:
      "Claude Code raises that tool's threshold to the annotated value, up to a hard ceiling of 500,000 characters.",
  },

  // --- hooks -------------------------------------------------------------------------------------
  {
    id: "hook.settings.json",
    value: "json",
    source: HOOKS,
    evidence: "Hooks are defined in JSON settings files.",
  },
  {
    id: "hook.exit.blocking-code",
    value: 2,
    source: HOOKS,
    evidence: "**Blocking error**: your hook exits 2. On events that can block, Claude Code stops the action.",
  },
  {
    id: "hook.exit.one-does-not-block",
    value: 1,
    source: HOOKS,
    evidence:
      "Exit code 1 without valid JSON output is a non-blocking error unless the hook is one [whose failure blocks the action](#block-the-action-when-a-hook-fails), even though 1 is the conventional Unix failure code.",
  },
  {
    id: "hook.exit.other-codes-non-blocking",
    value: "non-blocking",
    source: HOOKS,
    evidence:
      "**Non-blocking error**: your hook exits with any other code, or fails in some other way, such as not starting or printing invalid JSON.",
  },
  {
    id: "hook.post-tool-use.cannot-block",
    value: "PostToolUse",
    source: HOOKS,
    evidence: "| `PostToolUse`         | No         | Shows stderr to Claude; the tool already ran |",
  },
  {
    id: "hook.script.executable",
    value: true,
    source: HOOKS_GUIDE,
    evidence: "Hook scripts must be executable for Claude Code to run them:",
  },
  {
    id: "hook.timeout.default-seconds",
    value: { command: 600, prompt: 30, agent: 60 },
    source: HOOKS,
    evidence: "Defaults: 600 for `command`, `http`, and `mcp_tool`; 30 for `prompt`; 60 for `agent`.",
  },

  // --- nested instruction files: when a scoped brief is actually read ----------------------------
  //
  // /write-area-brief writes `<dir>/AGENTS.md` leaves. These say when Claude Code loads one.
  {
    id: "claude-md.nested.loads-on-touch",
    value: "on demand",
    source: MEMORY,
    evidence:
      "Instead of loading them at launch, Claude Code loads each one once Claude reads, writes, or edits another file in that subdirectory.",
  },
  {
    id: "agents-md.nested.loads-on-read",
    value: "Read",
    source: MEMORY,
    evidence:
      "**As Claude works in subdirectories**: a subdirectory's `AGENTS.md`, when Claude opens a file there with the Read tool and that subdirectory has none of the three `CLAUDE.md` files of its own",
  },

  // --- code review: what REVIEW.md is to Claude Code's own reviewer -------------------------------
  //
  // /setup-repo writes a REVIEW.md. These are what the managed Code Review does with it and with
  // CLAUDE.md. The managed reviewer no longer promises to flag a CLAUDE.md the change made wrong
  // (the docs dropped that sentence in October 2026), so the stamped REVIEW.md asks for it in its
  // own words and /review-change keeps it as its second axis. The local /code-review command does
  // not read REVIEW.md at all, so a rule both reviewers must apply belongs in CLAUDE.md.
  {
    id: "review.review-md.location",
    value: "REVIEW.md",
    source: REVIEW_CUSTOMIZE,
    evidence: "`REVIEW.md` is a file at your repository root that tailors Code Review to your repository.",
  },
  {
    id: "review.review-md.subdirectory",
    value: true,
    source: REVIEW_CUSTOMIZE,
    evidence:
      "You can also add a `REVIEW.md` in a subdirectory to add checks for changes under that path, on top of the root file.",
  },
  {
    id: "review.claude-md.violation-is-a-finding",
    value: "finding",
    source: REVIEW_CUSTOMIZE,
    evidence:
      "A change that violates one of their rules becomes a finding at whichever severity level fits the issue.",
  },
  {
    id: "review.check-run.neutral",
    value: "neutral",
    source: REVIEW_PRS,
    evidence: "It never concludes as a failure, so a finished review doesn't fail a required check.",
  },
  {
    id: "review.local-command.no-review-md",
    value: "CLAUDE.md",
    source: REVIEW_LOCAL,
    evidence: "It doesn't read `REVIEW.md`.",
  },

  // --- agent teams and worktrees: what the stamped team can rely on -------------------------------
  //
  // `templates/team/team-skill.md` tells a developer how the team's agents behave as teammates. The
  // page lists what a teammate takes from a definition; it has no sentence saying hooks are left
  // out, so that claim stays prose in the template and is not a rule here.
  {
    id: "team.off-by-default",
    value: "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
    source: TEAMS,
    evidence:
      "Agent teams are experimental and disabled by default. Enable them by setting `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in your settings.json or environment.",
  },
  {
    id: "team.definition.skills-not-applied",
    value: "skills",
    source: TEAMS,
    evidence: "Claude Code doesn't apply the definition's `skills` to a teammate in either display mode.",
  },
  {
    id: "team.one-per-session",
    value: 1,
    source: TEAMS,
    evidence: "a session has exactly one team, scoped to that session.",
  },
  {
    id: "team.no-nested",
    value: true,
    source: TEAMS,
    evidence: "teammates cannot spawn their own teammates.",
  },
  {
    id: "team.permissions.from-lead",
    value: "dontAsk",
    source: TEAMS,
    evidence: "Teammates start with the lead's permission mode, except `dontAsk` mode, which they don't inherit.",
  },
  {
    id: "worktree.gitignore",
    value: ".claude/worktrees/",
    source: WORKTREES,
    evidence:
      "Add `.claude/worktrees/` to your `.gitignore` so worktree contents don't appear as untracked files in your main checkout.",
  },
  {
    id: "worktree.subagent.instructions-from-main",
    value: "main conversation",
    source: WORKTREES,
    evidence:
      "A subagent in its own worktree takes the instruction files it starts with from your main conversation, not from its worktree.",
  },

  // --- settings files ----------------------------------------------------------------------------
  //
  // What a committed `.claude/settings.json` does for the people who clone it, which is the file
  // /setup-repo writes hooks into. The trust rules are the ones a team trips over: an allow rule waits
  // for each teammate, a deny rule does not.
  {
    id: "settings.strict-json",
    value: "json",
    source: SETTINGS,
    evidence:
      "Settings files are strict JSON: a `//` comment or a trailing comma is a syntax error, and Claude Code reports the file as a Settings Error at the next start.",
  },
  {
    id: "settings.project.commit-to-share",
    value: ".claude/settings.json",
    source: SETTINGS,
    evidence:
      "Commit `.claude/settings.json` so everyone who clones the repository gets the same permissions, hooks, and plugins.",
  },
  {
    id: "settings.trust.grants-wait",
    value: ["permissions.allow", "permissions.additionalDirectories", "extraKnownMarketplaces", "env"],
    source: SETTINGS,
    evidence:
      "`permissions.allow` rules, `permissions.additionalDirectories`, `extraKnownMarketplaces`, and most `env` values apply only after each teammate trusts the folder.",
  },
  {
    id: "settings.trust.deny-and-ask-apply-at-once",
    value: ["deny", "ask"],
    source: SETTINGS,
    evidence: "`deny` and `ask` rules apply right away.",
  },
  {
    id: "settings.default-mode.not-from-project",
    value: ["auto", "bypassPermissions"],
    source: SETTINGS,
    evidence:
      "`permissions.defaultMode` values `auto` and `bypassPermissions` don't take effect from project or local settings",
  },
  {
    id: "settings.reload.without-restart",
    value: ["permissions", "hooks"],
    source: SETTINGS,
    evidence:
      "Claude Code watches your settings files and reloads them when they change, so it applies most edits to the running session without a restart, including edits to `permissions`, `hooks`, and credential helpers such as `apiKeyHelper`.",
  },
  {
    id: "settings.local.tracked-is-repository-supplied",
    value: ".claude/settings.local.json",
    source: PERMISSIONS,
    evidence:
      "When the file is tracked in git, or `.claude` is a symlink, Claude Code treats it as repository-supplied instead and holds its rules until you trust the folder.",
  },

  // --- permission rules --------------------------------------------------------------------------
  //
  // How a rule and a hook combine, and the rule shapes that are accepted and then never matched.
  // `protected-paths.sh` and the Tester's fence both rest on the exit-2 rule; the trust rows say
  // where a fence written into a repository does not reach.
  {
    id: "permission.deny.any-level-wins",
    value: "deny",
    source: PERMISSIONS,
    evidence: "If a tool is denied at any level, no other level can allow it.",
  },
  {
    id: "permission.hook.does-not-bypass-rules",
    value: "PreToolUse",
    source: PERMISSIONS,
    evidence: "PreToolUse hook decisions don't bypass permission rules.",
  },
  {
    id: "permission.hook.exit-2-before-allow-rules",
    value: 2,
    source: PERMISSIONS,
    evidence:
      "A hook that exits with code 2 stops the tool call before permission rules are evaluated, so the block applies even when an allow rule would otherwise let the call proceed.",
  },
  {
    id: "permission.file-rules.tools",
    value: ["Edit", "Read"],
    source: PERMISSIONS,
    evidence: "Claude Code checks file permissions against `Edit(path)` and `Read(path)` rules only.",
  },
  {
    id: "permission.claudeignore.no-effect",
    value: ".claudeignore",
    source: PERMISSIONS,
    evidence:
      "If your project has a `.claudeignore` file, it has no effect, so move its entries into `Read` deny rules.",
  },
  {
    id: "permission.path.single-slash-anchors-at-source",
    value: "/",
    source: PERMISSIONS,
    evidence: "The single leading slash anchors at the settings source, not the filesystem root.",
  },
  {
    id: "permission.bash.compound-matches-each",
    value: "each subcommand",
    source: PERMISSIONS,
    evidence:
      "Every subcommand must be allowed for a compound command to run without a prompt, for example because the subcommand matches an allow rule or is a read-only command.",
  },
  {
    id: "permission.trust.headless-no-dialog",
    value: "claude -p",
    source: PERMISSIONS,
    evidence:
      "A `claude -p` run or an SDK session never shows it, and trusting a parent folder doesn't count for these rules",
  },
  {
    id: "permission.trust.subagent-hooks-need-trust",
    value: "not used",
    source: PERMISSIONS,
    evidence:
      "Frontmatter hooks in a project subagent, a project `@skills-dir` plugin, and `extraKnownMarketplaces` entries from the repository or an `--add-dir` directory | Not used, and no dialog is offered | Not used |",
  },

  // --- CLAUDE.md ---------------------------------------------------------------------------------
  {
    id: "claude-md.max-lines",
    value: 200,
    source: MEMORY,
    evidence:
      "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence.",
  },
  {
    id: "claude-md.imports",
    value: "@path/to/import",
    source: MEMORY,
    evidence: "CLAUDE.md files can import additional files using `@path/to/import` syntax.",
  },
  {
    id: "claude-md.broad-only",
    value: true,
    source: BEST,
    evidence:
      "Claude Code loads `CLAUDE.md` into every session, which means every line in it takes a little of Claude's attention on *every* task, whether it's relevant or not.",
  },
  {
    id: "claude-md.prune-test",
    value: "Could Claude work this out from the code itself?",
    source: BEST,
    evidence: "That's why the file works best when it only holds what Claude couldn't work out from the code itself",
  },
  {
    id: "claude-md.emphasis-not-the-fix",
    value: "a hook, or a shorter file",
    source: BEST,
    evidence:
      "If Claude keeps ignoring a line that *is* in `CLAUDE.md`, adding IMPORTANT probably won't fix it. Either the file has grown long enough that the line gets lost, or the line is a rule that can't have exceptions, in which case it belongs in a hook.",
  },

  // --- AGENTS.md: when Claude Code reads it without a CLAUDE.md, and what the shim costs -----------
  //
  // /write-context-docs writes CLAUDE.md as one line, `@AGENTS.md`. These are the sentences that say the
  // shim is still valid, and that a CLAUDE.md at the root stops a subdirectory's AGENTS.md loading
  // on its own. docs/adr/0021 holds the decision to keep it.
  {
    id: "agents-md.default-needs-no-claude-md",
    value: "claude-md-or-agents-md",
    source: MEMORY,
    evidence:
      "By default, Claude reads `AGENTS.md` only when you have no `CLAUDE.md` in your working directory or above it.",
  },
  {
    id: "agents-md.setting-loads-both",
    value: "claude-md-and-agents-md",
    source: MEMORY,
    evidence:
      "Your `CLAUDE.md` and `AGENTS.md` files together, each directory's `CLAUDE.md` files first and its `AGENTS.md` after them.",
  },
  {
    id: "agents-md.import-not-read-twice",
    value: "@AGENTS.md",
    source: MEMORY,
    evidence:
      "Keeping the import never makes Claude read `AGENTS.md` twice, whichever **Project instructions** value you use.",
  },
  {
    id: "agents-md.min-version",
    value: "2.1.277",
    source: MEMORY,
    evidence: "Reading `AGENTS.md` directly requires Claude Code v2.1.277 or later.",
  },

  // --- plugins: which folders are a plugin ---------------------------------------------------------
  {
    id: "plugin.manifest.optional",
    value: true,
    source: PLUGINS_REF,
    evidence:
      "The manifest is optional. Without it, Claude Code loads the components it finds in the standard layout.",
  },
  {
    id: "marketplace.source.relative-root",
    value: ".claude-plugin",
    source: MARKETPLACES,
    evidence: "The marketplace root is the directory that contains `.claude-plugin/`.",
  },

  // --- plugins: the manifest, the marketplace file, what loads, and when an update reaches a user --
  //
  // Cortex is a plugin, and the version rules are why it is stamped: a manifest that sets `version`
  // keeps every user on the copy they have until the string changes.
  {
    id: "plugin.files.at-root",
    value: ".claude-plugin",
    source: MANIFEST,
    evidence: "Put every other plugin file at the plugin root, not inside `.claude-plugin/`.",
  },
  {
    id: "plugin.manifest.unknown-top-level-stripped",
    value: "stripped",
    source: MANIFEST,
    evidence:
      "An unrecognized top-level key is stripped, and an unrecognized key inside a `userConfig` option, `channels` entry, `lspServers` config, or `monitors` entry is rejected",
  },
  {
    id: "plugin.manifest.path-prefix",
    value: "./",
    source: MANIFEST,
    evidence: "Every component path in a manifest is relative to the plugin root and must start with `./`.",
  },
  {
    id: "plugin.manifest.path-inside-and-exists",
    value: true,
    source: MANIFEST,
    evidence: "Every component path must resolve inside the plugin root and must exist.",
  },
  {
    id: "plugin.manifest.adds-to-default",
    value: ["skills"],
    source: MANIFEST,
    evidence:
      "**Adds to the default**: `skills`. The `skills/` directory is still scanned, and the listed directories load alongside it",
  },
  {
    id: "plugin.manifest.replaces-default",
    value: ["commands", "agents", "outputStyles", "workflows", "experimental.themes", "experimental.monitors"],
    source: MANIFEST,
    evidence:
      "**Replaces the default**: `commands`, `agents`, `outputStyles`, `workflows`, `experimental.themes`, `experimental.monitors`.",
  },
  {
    id: "plugin.name.reserved-prefixes",
    value: ["claude-", "anthropic-", "anthropics-", "cc-plugin-"],
    source: MANIFEST,
    evidence: "| Starts with `claude-`, `anthropic-`, `anthropics-`, or `cc-plugin-` | Error |",
  },
  {
    id: "plugin.version.pins",
    value: "version",
    source: MANIFEST,
    evidence: "Setting it pins the plugin to that version until you change it",
  },
  {
    id: "plugin.version.manifest-first",
    value: "version",
    source: LOADING,
    evidence:
      'Because the manifest comes first, a manifest that pins `"version": "1.0.0"` keeps every user on the cached copy until its author changes the string, however many commits they push.',
  },
  {
    id: "plugin.update.same-version-keeps-copy",
    value: "installed_plugins.json",
    source: LOADING,
    evidence:
      "`claude plugin update` and background auto-update compute the version again and don't replace the cached copy when it matches what `installed_plugins.json` records.",
  },
  {
    id: "plugin.auto-update.default",
    value: "off for every other marketplace",
    source: LOADING,
    evidence:
      "**The default**: on for Anthropic's official marketplaces such as `claude-plugins-official`, off for `knowledge-work-plugins` and `first-party-plugins`, on for marketplaces added from claude.ai, and off for every other marketplace",
  },
  {
    id: "plugin.cache.outside-files-not-copied",
    value: "..",
    source: LOADING,
    evidence:
      "Files outside the plugin directory aren't copied, so when a script inside a copied plugin reads a path above the plugin root, such as `../shared`, it doesn't find them",
  },
  {
    id: "plugin.path.forward-slashes",
    value: "/",
    source: LOADING,
    evidence:
      "Components declared with backslash paths therefore load on Windows only, so write component paths with forward slashes, such as `./commands/deploy.md`",
  },
  {
    id: "plugin.claude-md.not-loaded",
    value: "CLAUDE.md",
    source: COMPONENTS,
    evidence:
      "Claude Code doesn't load a `CLAUDE.md` at the plugin root, and `claude plugin validate` warns `CLAUDE.md at the plugin root is not loaded as project context`.",
  },
  // The subagents page lists three ignored keys (`subagent.plugin.ignored-keys`); this page adds a fourth.
  {
    id: "plugin.agent.ignored-keys",
    value: ["permissionMode", "hooks", "mcpServers", "initialPrompt"],
    source: COMPONENTS,
    evidence: "**Ignored fields**: `permissionMode`, `hooks`, `mcpServers`, and `initialPrompt`.",
  },
  {
    id: "plugin.hooks.file",
    value: "hooks/hooks.json",
    source: COMPONENTS,
    evidence:
      'Save the plugin\'s hooks in `hooks/hooks.json` at the plugin root, under a top-level `"hooks"` key, in the same shape as the `hooks` object in `settings.json`.',
  },
  {
    id: "plugin.hooks.fire-from-load",
    value: "session load",
    source: COMPONENTS,
    evidence: "Claude Code registers them when a session loads the plugin, and they fire on their events from then on.",
  },
  {
    id: "marketplace.required-fields",
    value: ["name", "owner", "plugins"],
    source: MARKETPLACE_REF,
    evidence: "`name`, `owner`, and `plugins` are required.",
  },
  {
    id: "marketplace.entry.required-fields",
    value: ["name", "source"],
    source: MARKETPLACE_REF,
    evidence: "`name` and `source` are required.",
  },
  {
    id: "marketplace.unknown-key-ignored",
    value: "ignored",
    source: MARKETPLACE_REF,
    evidence:
      "Claude Code ignores an unknown top-level key or plugin-entry key rather than rejecting it, so a typo loads silently.",
  },
  {
    id: "marketplace.entry.version-manifest-wins",
    value: "plugin.json",
    source: MARKETPLACE_REF,
    evidence:
      "When `plugin.json` also sets `version`, `plugin.json` takes precedence and `claude plugin validate` warns.",
  },
  // --- mods: a plugin whose handlers run inside Claude Code ---------------------------------------
  //
  // The docs call the older kind "settings hooks" and use "hook" for a mod's handler. The `hook.*`
  // rules above are all about settings hooks.
  {
    id: "mod.min-version",
    value: "2.1.287",
    source: MODS,
    // The terminal's floor. The same paragraph says the Desktop app carries its own copy of Claude
    // Code and runs mods from v2.1.286; Cortex states the terminal's, the higher of the two.
    evidence: "In the terminal, use Claude Code v2.1.287 or later.",
  },
  {
    id: "mod.not-sandboxed",
    value: true,
    source: MODS,
    evidence:
      "If you turn on sandboxing, the sandbox isolates the Bash commands Claude runs, and a process that a mod starts runs outside it.",
  },
  {
    id: "mod.hooks-json.modules",
    value: "modules",
    source: MODS_REF,
    evidence: "`modules`: an array with one path, relative to this file, to the hooks module",
  },
  {
    id: "mod.module.extensions",
    value: [".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"],
    source: MODS_REF,
    evidence: "Named `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, or `.tsx`.",
  },
  {
    id: "mod.guard.pretooluse-wins",
    value: "PreToolUse",
    source: MODS_ADMIN,
    evidence: "The mod can't approve a call that any `PreToolUse` hook blocked, either.",
  },
  {
    // Only with the guard loaded. Without it nothing says a hook wins, so the fences name the gap.
    id: "mod.guard.loads-when",
    value: ["managed settings", "Team or Enterprise login"],
    source: MODS_ADMIN,
    evidence:
      "A user who authenticates with an API key, or through Amazon Bedrock, Google Cloud's Agent Platform, or Microsoft Foundry, gets the guard only on a machine that has managed settings.",
  },

  // --- permissions: why an unattended /setup-repo cannot write under .claude/ ------------------------
  //
  // /setup-repo stamps .claude/agents/, .claude/hooks/ and .claude/settings.json. Headless (`claude -p`)
  // those writes are refused, and no allow rule changes that — the five rules below are the chain
  // of sentences that says so, and `protectedClaudePath()` is the one place the directory test lives.
  {
    id: "permission.protected-path.claude-dir",
    value: ".claude",
    source: MODES,
    evidence: "`.claude`, with a few exceptions, such as:",
  },
  {
    id: "permission.protected-path.claude-dir.worktrees",
    value: ".claude/worktrees",
    source: MODES,
    evidence: "Claude's own git worktrees under `.claude/worktrees/`",
  },
  {
    id: "permission.protected-path.never-auto-approved",
    value: "bypassPermissions",
    source: MODES,
    evidence:
      "Writes to a small set of paths are never auto-approved, except in `bypassPermissions` mode and in interactive terminal sessions in plan mode with bypass permissions available.",
  },
  {
    id: "permission.protected-path.allow-rules-do-not-apply",
    value: "Edit(.claude/**)",
    source: MODES,
    evidence:
      "The safety check runs before Claude Code evaluates allow rules from settings, so an entry such as `Edit(.claude/**)` in `~/.claude/settings.json` or `.claude/settings.json` does not change the per-mode outcome in the table above.",
  },
  {
    id: "permission.protected-path.auto-mode-classifier",
    value: "auto",
    source: MODES,
    evidence: "Writes to protected paths route to the classifier even when an allow rule matches",
  },
  {
    id: "headless.permission.no-host-denied",
    value: "denied",
    source: HEADLESS,
    evidence: "In a `-p` run with no host, these requests are denied either way, and the flag also tells Claude not to retry them.",
  },

  // --- the model: what a direct Messages API caller and an unattended runner must assume ----------
  {
    id: "model.effort.default-medium",
    value: "medium",
    source: OPUS_5_5,
    evidence:
      "Start at `medium`, the default on Claude Opus 5.5 (Claude Opus 5 defaults to `high`), set it explicitly, and test several levels against your own evals rather than carrying over the setting you used on Claude Opus 5.",
  },
  {
    id: "model.thinking.counts-toward-max-tokens",
    value: true,
    source: OPUS_5_5,
    evidence:
      "Thinking counts toward `max_tokens` even when thinking content isn't returned to you, so a limit sized for Claude Opus 5 with thinking off can cut replies off.",
  },
  {
    id: "model.response.read-by-block-type",
    value: "text",
    source: OPUS_5_5,
    evidence:
      "Check each block's type instead of assuming the first content block is text: a response might or might not start with a `thinking` block, whose `thinking` field is empty under the default `display: \"omitted\"`.",
  },
  {
    id: "model.response.refusal-stop-reason",
    value: "refusal",
    source: OPUS_5_5,
    evidence:
      "A classifier decline arrives as a normal response with `stop_reason: \"refusal\"` and a `stop_details` object naming the category.",
  },
  {
    id: "model.thinking.cannot-disable",
    value: "thinking: {\"type\": \"disabled\"}",
    source: OPUS_5_5,
    evidence:
      "Claude Opus 5 accepts `thinking: {\"type\": \"disabled\"}` at `high` effort or below; Claude Opus 5.5 doesn't, and the migration guide covers the request change.",
  },
  {
    id: "model.prompt.no-reasoning-in-response",
    value: "reasoning_extraction",
    source: OPUS_5_5,
    evidence:
      "Requests that push the model to reproduce its internal reasoning in the response text might be declined with the `reasoning_extraction` category.",
  },
  {
    id: "model.agentic.end-turn-is-a-report",
    value: "end_turn",
    source: OPUS_5_5,
    evidence: "Treat a text-only end of turn as a report rather than as proof the task is done.",
  },
  {
    id: "model.agentic.continuation-cap",
    value: 3,
    source: OPUS_5_5,
    evidence:
      "Either way, stop after two or three automatic continuations on the same task rather than repeating them indefinitely, so that a run that is genuinely stuck ends and can be reviewed.",
  },
].map((r) => Object.freeze({ ...r, checked: CHECKED })));

/** One rule by id. Throws on an unknown id, so a typo in a consumer fails loudly, not as `undefined`. */
export function rule(id) {
  const found = RULES.find((r) => r.id === id);
  if (!found) throw new Error(`core/claude-code.js has no rule "${id}"`);
  return found;
}

/** A rule's value — the number, key list or string a check compares against. */
export function limit(id) {
  return rule(id).value;
}

/**
 * Is a write to this repo-relative path one Claude Code treats as a protected-path write under
 * `.claude/`? Those are never auto-approved outside `bypassPermissions`, an allow rule does not
 * change that, and in a `claude -p` run nobody is there to answer the prompt — so the write is
 * refused. `.claude/worktrees` is the one exception applied here. The page lists others (the
 * session's plan files and a background session's scratch directory, both under `~/.claude`, and
 * markdown in an auto-memory or `.claude/agent-memory/` directory when the session was not started
 * with `--restricted`). Cortex stamps into none of them and cannot see that flag, so they stay
 * protected here: the answer errs toward "this write may be refused". Cortex stamps no other
 * protected directory, so this answers only for `.claude`; widen it from the rule's page, not from
 * memory.
 */
export function protectedClaudePath(rel) {
  const dir = limit("permission.protected-path.claude-dir");
  const p = String(rel).replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  const inside = p === dir || p.startsWith(`${dir}/`);
  const worktrees = limit("permission.protected-path.claude-dir.worktrees");
  return inside && p !== worktrees && !p.startsWith(`${worktrees}/`);
}

/**
 * The trigger phrasing a model-facing description carries, or null — what `skill.disable-model-invocation`
 * makes pointless on a skill only a person can invoke. Deliberately simple: "Use when", "Triggers", or
 * two or more quoted phrases, the three shapes a trigger list takes. It lives here, beside the rule,
 * because two readers apply it — tools/cortex-frontmatter.mjs to Cortex's own skills and
 * index/lib/claude-setup.mjs to a user's — and two copies of one heuristic drift apart.
 */
export function triggerPhrasing(desc) {
  const m = desc.match(/\buse (?:it )?when\b|\btriggers?\b/i);
  if (m) return m[0];
  const quoted = desc.match(/"[^"]{2,}"/g) ?? [];
  return quoted.length >= 2 ? quoted.slice(0, 2).join(", ") : null;
}
