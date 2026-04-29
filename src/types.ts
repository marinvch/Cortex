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
}
