export const REQUIRED_AGENT_SECTIONS = [
  'Common Rationalizations',
  'Rationalization Rebuttals',
] as const;

export interface AgentContractValidationResult {
  valid: boolean;
  missingSections: string[];
}

interface AgentContractContext {
  agentName?: string;
}

function hasSection(content: string, sectionName: string): boolean {
  const headerRegex = new RegExp(`^##\\s+${sectionName}\\s*$`, 'im');
  return headerRegex.test(content);
}

export function validateAgentContract(content: string): AgentContractValidationResult {
  const missingSections = REQUIRED_AGENT_SECTIONS.filter((section) => !hasSection(content, section));
  return {
    valid: missingSections.length === 0,
    missingSections,
  };
}

function normalizeAgentName(agentName?: string): string {
  if (!agentName) return 'this workflow';
  return agentName
    .replace(/\.agent\.md$/g, '')
    .replace(/-/g, ' ')
    .trim();
}

export function enforceAgentContract(content: string, context: AgentContractContext = {}): string {
  const missing = validateAgentContract(content).missingSections;
  if (missing.length === 0) return content;

  const scope = normalizeAgentName(context.agentName);
  const sectionsToAppend: string[] = [];

  for (const section of missing) {
    if (section === 'Common Rationalizations') {
      sectionsToAppend.push(
        '## Common Rationalizations',
        '',
        '- "This request is urgent; I can skip discovery and validation."',
        '- "It is a small change, so guardrails are optional."',
        '- "I can fix side effects later if anything breaks."',
      );
      continue;
    }

    if (section === 'Rationalization Rebuttals') {
      sectionsToAppend.push(
        '## Rationalization Rebuttals',
        '',
        `- Urgency does not remove verification requirements for ${scope}.`,
        '- Small unchecked edits are a common source of regressions and drift.',
        '- Delayed safety checks increase rollback cost and user-facing risk.',
      );
    }
  }

  return `${content.trimEnd()}\n\n${sectionsToAppend.join('\n')}\n`;
}
