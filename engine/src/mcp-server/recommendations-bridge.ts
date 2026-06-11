/**
 * recommendations-bridge.ts — getRecommendations and suggestImprovements
 * for AI OS MCP server.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './shared.js';

// ── Tool #20: Recommendations ──────────────────────────────────────────────────

export function getRecommendations(): string {
  const recommendationsPath = path.join(ROOT, '.github', 'ai-os', 'recommendations.md');
  if (fs.existsSync(recommendationsPath)) {
    return fs.readFileSync(recommendationsPath, 'utf-8');
  }
  return 'No recommendations file found. Run AI OS generation with recommendations enabled to create .github/ai-os/recommendations.md.';
}

// ── Tool #21: Suggest Improvements ────────────────────────────────────────────

export function suggestImprovements(): string {
  const suggestions: string[] = [];

  // Check for missing env var documentation
  const envExamplePaths = ['.env.example', '.env.local.example', '.env.sample'];
  const hasEnvExample = envExamplePaths.some(p => fs.existsSync(path.join(ROOT, p)));
  if (!hasEnvExample) {
    suggestions.push('**Missing `.env.example`**: Document required environment variables so `get_env_vars` can surface them.');
  }

  // Check for missing COPILOT_CONTEXT.md
  if (!fs.existsSync(path.join(ROOT, '.github', 'COPILOT_CONTEXT.md'))) {
    suggestions.push('**Missing `COPILOT_CONTEXT.md`**: Re-run the AI OS installer (`npx -y github:marinvch/ai-os --refresh-existing`) to generate the session context card for better session continuity.');
  }

  // Check for missing recommendations.md
  if (!fs.existsSync(path.join(ROOT, '.github', 'ai-os', 'recommendations.md'))) {
    suggestions.push('**Missing `recommendations.md`**: Re-run the AI OS installer (`npx -y github:marinvch/ai-os --refresh-existing`) to generate stack-specific tool recommendations.');
  }

  // Check memory freshness
  const memoryPath = path.join(ROOT, '.github', 'ai-os', 'memory', 'memory.jsonl');
  if (!fs.existsSync(memoryPath)) {
    suggestions.push('**No repository memory found**: Use `remember_repo_fact` to capture key architectural decisions.');
  } else {
    const content = fs.readFileSync(memoryPath, 'utf-8').trim();
    if (!content) {
      suggestions.push('**Empty repository memory**: Use `remember_repo_fact` to capture key architectural decisions and conventions.');
    }
  }

  // Check for architecture doc
  const archPath = path.join(ROOT, '.github', 'ai-os', 'context', 'architecture.md');
  if (!fs.existsSync(archPath)) {
    suggestions.push('**Missing architecture doc**: Re-run the AI OS installer (`npx -y github:marinvch/ai-os --refresh-existing`) to rebuild `.github/ai-os/context/architecture.md`.');
  }

  // Config-based suggestions
  const configPath = path.join(ROOT, '.github', 'ai-os', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        persistentRules?: string[];
        recommendations?: boolean;
      };
      if (!config.persistentRules || config.persistentRules.length === 0) {
        suggestions.push('**No persistent rules defined**: Add `persistentRules` in `.github/ai-os/config.json` for rules that survive context window resets (e.g. "use shared components from components/ui").');
      }
      if (config.recommendations === false) {
        suggestions.push('**Recommendations disabled**: Set `"recommendations": true` in `.github/ai-os/config.json` to enable stack-specific tool suggestions.');
      }
    } catch {
      // ignore
    }
  }

  if (suggestions.length === 0) {
    return '## Improvement Suggestions\n\nNo actionable improvements found. Your AI OS setup looks healthy!\n\nConsider:\n- Adding more persistent rules in `config.json` for frequently forgotten conventions\n- Calling `remember_repo_fact` after major architectural decisions';
  }

  return [
    '## Improvement Suggestions',
    '',
    ...suggestions.map(s => `- ${s}`),
  ].join('\n');
}
