export interface DetectedLanguage {
  name: string;
  percentage: number;
  fileCount: number;
  extensions: string[];
}

export interface DetectedFramework {
  name: string;
  category: 'frontend' | 'backend' | 'fullstack' | 'mobile' | 'cli' | 'library' | 'unknown';
  version?: string;
  template: string;
}

export interface DetectedPatterns {
  namingConvention: 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case' | 'mixed';
  testFramework?: string;
  linter?: string;
  formatter?: string;
  bundler?: string;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'pip' | 'poetry' | 'cargo' | 'go' | 'maven' | 'gradle' | 'dotnet' | 'composer' | 'bundler' | 'unknown';
  hasTypeScript: boolean;
  hasDockerfile: boolean;
  hasCiCd: boolean;
  ciCdProvider?: string;
  monorepo: boolean;
  srcDirectory: boolean;
  testDirectory?: string;
}

export interface BuildCommands {
  build?: string;
  test?: string;
  dev?: string;
  lint?: string;
  start?: string;
  [key: string]: string | undefined;
}

export interface DetectedStack {
  projectName: string;
  primaryLanguage: DetectedLanguage;
  languages: DetectedLanguage[];
  primaryFramework?: DetectedFramework;
  frameworks: DetectedFramework[];
  patterns: DetectedPatterns;
  keyFiles: string[];
  rootDir: string;
  /** All dependency keys from package.json / pyproject.toml / Cargo.toml etc. */
  allDependencies: string[];
  packageProfiles?: PackageProfile[];
  /** Detected build/test commands from package.json, Makefile, pyproject.toml, etc. */
  buildCommands?: BuildCommands;
}

export interface PackageProfile {
  name: string;
  path: string;
  languages: DetectedLanguage[];
  frameworks: DetectedFramework[];
  patterns: DetectedPatterns;
  keyFiles: string[];
  allDependencies: string[];
}

/** Alias for PackageProfile — represents a single workspace package in a monorepo. */
export type WorkspacePackage = PackageProfile;

export interface FileNode {
  /** Relative path from project root (forward slashes) */
  path: string;
  /** Files this file imports (relative paths) */
  imports: string[];
  /** Files that import this file (reverse edges) */
  importedBy: string[];
  /** Named exports declared in this file */
  exports: string[];
}

export interface DependencyGraph {
  nodes: Record<string, FileNode>;
  generatedAt: string;
  fileCount: number;
}

/**
 * Installation profile controlling context density.
 * - minimal  : only essential instructions + MCP wiring (no agents, recommendations, or workflows)
 * - standard : balanced default (recommended for most projects)
 * - full     : all stack-relevant integrations enabled
 */
export type InstallProfile = 'minimal' | 'standard' | 'full';

/** User-editable + auto-detected config written to .github/ai-os/config.json */
export interface AiOsConfig {
  /** AI OS version that wrote this config */
  version: string;
  installedAt: string;
  projectName: string;
  primaryLanguage: string;
  primaryFramework: string | null;
  frameworks: string[];
  packageManager: string;
  hasTypeScript: boolean;
  // ── User-editable feature flags ──────────────────────────────────────────
  /** Generate AGENTS.md (opt-in, default: false) */
  agentsMd: boolean;
  /** Generate path-specific .instructions.md files (default: true) */
  pathSpecificInstructions: boolean;
  /** Generate recommendations.md (default: true) */
  recommendations: boolean;
  /** Generate COPILOT_CONTEXT.md session context card (default: true) */
  sessionContextCard: boolean;
  /** Generate weekly update-check workflow in target repos (default: true) */
  updateCheckEnabled: boolean;
  /**
   * Skill generation strategy:
   * - 'creator-only'      : deploy only bundled skill-creator (default)
   * - 'predefined+creator': also generate stack-based predefined skills in .github/copilot/skills
   */
  skillsStrategy?: 'creator-only' | 'predefined+creator';
  /**
   * Persistent rules injected verbatim into copilot-instructions.md and
   * preserved through refreshes. Edit here to survive regeneration.
   */
  persistentRules: string[];
  /** Glob patterns to exclude from analysis (in addition to defaults) */
  exclude: string[];
  /**
   * How to handle the sequential agent flow (Enhancement Advisor → Idea Validator → Implementation Agent).
   * - 'create'  : generate all three agents (default for new installs)
   * - 'hook'    : print a guide for connecting ai-os to existing agents instead of creating new ones
   * - 'skip'    : do not generate sequential agents
   */
  agentFlowMode?: 'create' | 'hook' | 'skip';
  /**
   * Strict stack filtering for generated MCP tool catalog and recommendations.
   * When true (default), tools.json is split into activeTools (stack-eligible) and
   * availableButInactive (conditions not met). Recommendations also separate
   * stack-specific items from universal/optional ones.
   * Set to false to revert to a flat, unfiltered tool catalog.
   */
  strictStackFiltering?: boolean;
  /**
   * Installation profile used when the repo was first set up (or last refreshed
   * with an explicit --profile flag).  Persisted so that subsequent refreshes
   * without a flag maintain the same density level.
   */
  profile?: InstallProfile;
  /**
   * Memory entry TTL in days. Entries older than this threshold are marked stale
   * and will be removed on the next prune/compact run.
   * Default: 180 days.
   */
  memoryTtlDays?: number;
  /**
   * Jaccard similarity threshold for near-duplicate detection.
   * Entries with the same title+category and content similarity above this value
   * are treated as near-duplicates; the older one is marked stale.
   * Range: 0.5–1.0. Default: 0.85.
   */
  memoryNearDuplicateThreshold?: number;
  /**
   * When false, skip generating .github/instructions/prompt-quality.instructions.md.
   * Default: true.
   */
  promptQualityPack?: boolean;
  /**
   * Skill version tracking: maps skill name to SHA-256 content hash.
   * Populated by --refresh-existing. Checked by --doctor and detect_drift.
   */
  skillVersions?: Record<string, string>;
  /**
   * Allow run_tests, run_lint, and run_build MCP tools to execute shell commands.
   * Default: false (must be explicitly enabled or set AI_OS_ALLOW_RUN_TOOLS=1).
   */
  allowRunTools?: boolean;
  /**
   * Target AI model for generated instructions.
   * Defaults to 'copilot' (standard Markdown). Other values produce companion files.
   */
  model?: 'copilot' | 'claude' | 'gemini' | 'local';
  /**
   * Additional editor targets for generated configs.
   * 'vscode' is always included. Others produce companion files.
   */
  editorTargets?: Array<'vscode' | 'cursor' | 'jetbrains' | 'neovim' | 'all'>;
}

/** Runtime type guard for AiOsConfig JSON artifacts. */
export function isAiOsConfig(obj: unknown): obj is AiOsConfig {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o['version'] === 'string' &&
    typeof o['installedAt'] === 'string' &&
    typeof o['projectName'] === 'string' &&
    typeof o['primaryLanguage'] === 'string' &&
    typeof o['packageManager'] === 'string' &&
    typeof o['hasTypeScript'] === 'boolean' &&
    Array.isArray(o['persistentRules']) &&
    Array.isArray(o['exclude'])
  );
}

/** One entry in the agent registry — A2A-inspired AgentCard for a generated agent. */
export interface AgentRegistryEntry {
  /** Display name of the agent (e.g. "Payments Expert") */
  name: string;
  /** Filename in .github/agents/ (e.g. "expert-payments.agent.md") */
  file: string;
  /** What this agent can do (used by orchestrator to match tasks) */
  capabilities: string[];
  /** Lowercase keywords that trigger routing to this agent */
  triggers: string[];
  /** One-sentence summary used in the orchestrator's agent list */
  description: string;
}

// ── Prompt Intelligence types ─────────────────────────────────────────────────

/** 9 intent categories recognised by the Intent Classification Protocol. */
export type IntentType =
  | 'new-feature'
  | 'bug-fix'
  | 'refactor'
  | 'db-change'
  | 'test-addition'
  | 'dependency-update'
  | 'docs-update'
  | 'config-change'
  | 'quick-edit';

/** A single clarifying question surfaced by the Prompt Booster. */
export interface ClarifyingQuestion {
  /** Identifies which gap this question addresses */
  id: 'what' | 'where' | 'how';
  /** The question text to show the user */
  text: string;
  /** Optional multiple-choice hints */
  choices?: string[];
  required: boolean;
}

/** Output of `detect_intent` / `classifyIntent()`. */
export interface IntentResult {
  intentType: IntentType;
  /** Keyword-match confidence */
  confidence: 'high' | 'medium' | 'low';
  /** Broad domains affected (e.g. "database", "auth") */
  affectedDomain: string[];
  /** Skill name to route to, if any */
  suggestedSkill: string | null;
  /** WORKFLOW-FORK question to ask the user, if applicable */
  clarifyingQuestion: string | null;
  /** Short human-readable rationale */
  reasoning: string;
}

/** Output of `boost_prompt` / `boostPrompt()`. */
export interface BoostPromptResult {
  /** Raw vagueness score (0–5) */
  vaguenessScore: number;
  /** True when score ≥ 3 and booster was activated */
  triggered: boolean;
  /** Up to 3 clarifying questions (empty when not triggered) */
  questions: ClarifyingQuestion[];
  /** Synthesized prompt shown to user for confirmation (set after answers) */
  optimizedPrompt?: string;
  /** Broad domains the optimised prompt touches */
  affectedDomain?: string[];
  /** Suggested skill routing for the optimised prompt */
  suggestedSkill?: string;
  /** Confirmation message summarising what was understood */
  confirmationMessage?: string;
}

/** The full agent registry written to .github/ai-os/agents.json */
export interface AgentRegistry {
  version: '1';
  generatedAt: string;
  agents: AgentRegistryEntry[];
}

/** Runtime type guard for AgentRegistry — validates JSON loaded from agents.json */
export function isAgentRegistry(value: unknown): value is AgentRegistry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['version'] !== '1') return false;
  if (typeof v['generatedAt'] !== 'string') return false;
  if (!Array.isArray(v['agents'])) return false;
  return v['agents'].every(
    (a) =>
      typeof a === 'object' &&
      a !== null &&
      typeof (a as Record<string, unknown>)['name'] === 'string' &&
      typeof (a as Record<string, unknown>)['file'] === 'string' &&
      Array.isArray((a as Record<string, unknown>)['capabilities']) &&
      Array.isArray((a as Record<string, unknown>)['triggers']) &&
      typeof (a as Record<string, unknown>)['description'] === 'string'
  );
}
