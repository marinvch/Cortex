export const REQUIRED_SKILL_SECTIONS = [
  'Overview',
  'When to Use',
  'Process',
  'Common Rationalizations',
  'Red Flags',
  'Verification',
] as const;

export interface SkillContractValidationResult {
  valid: boolean;
  missingSections: string[];
}

interface SkillContractContext {
  skillName?: string;
}

function hasSection(content: string, sectionName: string): boolean {
  const headerRegex = new RegExp(`^##\\s+${sectionName}\\s*$`, 'im');
  return headerRegex.test(content);
}

export function validateSkillContract(content: string): SkillContractValidationResult {
  const missingSections = REQUIRED_SKILL_SECTIONS.filter((section) => !hasSection(content, section));
  return {
    valid: missingSections.length === 0,
    missingSections,
  };
}

function normalizeSkillName(skillName?: string): string {
  if (!skillName) return 'this area';
  return skillName.replace(/^ai-os-/, '').replace(/-patterns|-flow|-pipeline|-api|-billing/g, '').replace(/-/g, ' ').trim();
}

export function enforceSkillContract(content: string, context: SkillContractContext = {}): string {
  const missing = validateSkillContract(content).missingSections;
  if (missing.length === 0) return content;

  const domain = normalizeSkillName(context.skillName);
  const sectionsToAppend: string[] = [];

  for (const section of missing) {
    if (section === 'Overview') {
      sectionsToAppend.push(
        '## Overview',
        '',
        `Guidance patterns for ${domain} in this project.`,
      );
      continue;
    }

    if (section === 'When to Use') {
      sectionsToAppend.push(
        '## When to Use',
        '',
        `- Use when implementing or modifying ${domain} related code.`,
        '- Use when you need project-consistent patterns and safer defaults.',
      );
      continue;
    }

    if (section === 'Process') {
      sectionsToAppend.push(
        '## Process',
        '',
        '- Review relevant project patterns first.',
        '- Apply the guidance in this skill to the target change.',
        '- Validate with tests/build checks before finalizing.',
      );
      continue;
    }

    if (section === 'Common Rationalizations') {
      sectionsToAppend.push(
        '## Common Rationalizations',
        '',
        '| Rationalization | Reality |',
        '|---|---|',
        '| "This is small, I can skip the pattern." | Small changes still create long-term drift when patterns are skipped. |',
        '| "I will validate later." | Delayed validation increases rework and hides regressions. |',
      );
      continue;
    }

    if (section === 'Red Flags') {
      sectionsToAppend.push(
        '## Red Flags',
        '',
        '- No reference to existing project conventions or patterns.',
        '- Changes introduced without verification steps.',
        '- New behavior added without corresponding checks/tests.',
      );
      continue;
    }

    if (section === 'Verification') {
      sectionsToAppend.push(
        '## Verification',
        '',
        '- [ ] The change follows existing project conventions.',
        '- [ ] Relevant tests/build checks pass.',
        '- [ ] Behavior is verified against expected outcomes.',
      );
    }
  }

  const appendBlock = sectionsToAppend.join('\n');
  return `${content.trimEnd()}\n\n${appendBlock}\n`;
}
