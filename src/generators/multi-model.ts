/**
 * multi-model.ts — Adapt generated instructions for different AI model backends.
 *
 * Supported targets:
 * - copilot (default): standard Markdown output for GitHub Copilot
 * - claude: XML-tagged sections preferred by Anthropic Claude models
 * - gemini: shorter focused sections for Google Gemini's retrieval patterns
 * - local: ultra-compact output for small context windows (4K-8K tokens)
 */

export type ModelTarget = 'copilot' | 'claude' | 'gemini' | 'local';

export function parseModelTarget(raw: string): ModelTarget | null {
  const models: ModelTarget[] = ['copilot', 'claude', 'gemini', 'local'];
  const lower = raw.toLowerCase() as ModelTarget;
  return models.includes(lower) ? lower : null;
}

/**
 * Transform Markdown instructions for Claude models.
 * Claude responds best to XML-tagged sections with explicit role assignment.
 */
export function adaptForClaude(content: string): string {
  // Wrap major sections in XML tags Claude understands
  const sections = content.split(/\n(?=## )/);
  const wrapped = sections.map(section => {
    const match = section.match(/^## (.+)\n/);
    if (!match) return section;
    const heading = match[1].trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const body = section.slice(match[0].length);
    return `<${heading}>\n${match[0]}${body}</${heading}>`;
  });

  const header = content.match(/^# .+\n([\s\S]*?)(?=\n## )/)?.[0] ?? '';
  const sectionsContent = wrapped.join('\n');
  return `<instructions>\n${sectionsContent}\n</instructions>\n`;
}

/**
 * Transform instructions for Gemini models.
 * Gemini works best with shorter, well-structured sections and explicit structure.
 * Strips verbose explanations; keeps rules, commands, and key constraints.
 */
export function adaptForGemini(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inVerboseBlock = false;

  for (const line of lines) {
    // Skip HTML comments
    if (line.trim().startsWith('<!--') && line.trim().endsWith('-->')) continue;
    // Skip long prose paragraphs (>100 chars without list/heading markers)
    if (line.length > 100 && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('|') && !line.startsWith('`')) {
      // Include first 100 chars as summary
      result.push(line.slice(0, 100) + '…');
      continue;
    }
    result.push(line);
  }

  return result.join('\n');
}

/**
 * Transform instructions for local/small-context models (4K-8K tokens).
 * Produces a compact version: only essential rules, build commands, and key files.
 * Strips documentation, prose, and verbose sections.
 */
export function adaptForLocal(content: string): string {
  const lines = content.split('\n');
  const essential: string[] = [];
  let inEssentialSection = false;
  let inSkipSection = false;
  const skipSections = new Set([
    'session restart protocol',
    'memory workflow',
    'agentic task safety',
    'escalation flow',
    'prompt injection awareness',
  ]);
  const keepSections = new Set([
    'tech stack',
    'build commands',
    'key files',
    'general rules',
    'detected conventions',
    'commands',
    'boundaries',
  ]);

  for (const line of lines) {
    const headingMatch = line.match(/^#+\s+(.+)/);
    if (headingMatch) {
      const heading = headingMatch[1].toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      inEssentialSection = keepSections.has(heading);
      inSkipSection = skipSections.has(heading);
    }

    // Always include top-level headers and horizontal rules
    if (line.startsWith('# ') || line === '---') {
      essential.push(line);
      continue;
    }

    if (inSkipSection) continue;
    if (inEssentialSection) {
      // Skip verbose prose (sentences > 80 chars without code/list markers)
      if (line.length > 80 && !line.startsWith('-') && !line.startsWith('|') && !line.startsWith('`') && !line.startsWith('#')) {
        continue;
      }
      essential.push(line);
    }
  }

  // Remove runs of blank lines
  const deduped = essential.join('\n').replace(/\n{3,}/g, '\n\n');
  return `<!-- Compact instructions for local LLM — full version: .github/copilot-instructions.md -->\n${deduped}\n`;
}

/**
 * Apply model-specific transformation to instruction content.
 * 'copilot' (default) returns content unchanged.
 */
export function adaptInstructionsForModel(content: string, model: ModelTarget): string {
  switch (model) {
    case 'claude': return adaptForClaude(content);
    case 'gemini': return adaptForGemini(content);
    case 'local': return adaptForLocal(content);
    case 'copilot':
    default: return content;
  }
}

/**
 * Returns the output file path for the model-specific instructions.
 * VS Code Copilot reads the canonical path; other models get a companion file.
 */
export function getModelOutputPath(model: ModelTarget, githubDir: string): string {
  switch (model) {
    case 'claude': return `${githubDir}/ai-os/claude-instructions.md`;
    case 'gemini': return `${githubDir}/ai-os/gemini-instructions.md`;
    case 'local': return `${githubDir}/ai-os/local-instructions.md`;
    case 'copilot':
    default: return `${githubDir}/copilot-instructions.md`;
  }
}
