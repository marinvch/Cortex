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
