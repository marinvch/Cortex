/**
 * workflow-runner.ts — Agent workflow chaining: structured multi-agent pipelines.
 *
 * Parses .github/ai-os/workflows/*.yml chain definitions and produces
 * execution plans or dry-run summaries. Actual step execution is performed
 * by the AI model — this module handles parsing, validation, and sequencing.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface WorkflowStep {
  agent: string;
  input?: string;
  output?: string;
  description?: string;
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

export interface WorkflowValidationError {
  step: number;
  field: string;
  message: string;
}

export interface WorkflowRunPlan {
  workflow: WorkflowDefinition;
  steps: Array<{
    index: number;
    agent: string;
    inputFrom?: string;
    outputAs?: string;
    prompt: string;
  }>;
  dryRun: boolean;
}

/** Parse a workflow YAML string. Uses simple key-value parser (no external deps). */
export function parseWorkflowYaml(yaml: string): WorkflowDefinition {
  const lines = yaml.split('\n');
  const result: Partial<WorkflowDefinition> = { steps: [] };
  let inSteps = false;
  let currentStep: Partial<WorkflowStep> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.trimStart().startsWith('#')) continue;

    // Top-level fields
    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) { result.name = nameMatch[1].trim().replace(/^['"]|['"]$/g, ''); continue; }

    const descMatch = line.match(/^description:\s*(.+)/);
    if (descMatch) { result.description = descMatch[1].trim().replace(/^['"]|['"]$/g, ''); continue; }

    if (line.match(/^steps:\s*$/)) { inSteps = true; continue; }

    if (!inSteps) continue;

    // Step list item
    if (line.match(/^  - /)) {
      if (currentStep && currentStep.agent) result.steps!.push(currentStep as WorkflowStep);
      currentStep = {};
      const inline = line.slice(4).trim();
      const inlineAgentMatch = inline.match(/^agent:\s*(.+)/);
      if (inlineAgentMatch) currentStep.agent = inlineAgentMatch[1].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }

    if (!currentStep) continue;

    // Step fields
    const agentMatch = line.match(/^    agent:\s*(.+)/);
    if (agentMatch) { currentStep.agent = agentMatch[1].trim().replace(/^['"]|['"]$/g, ''); continue; }

    const inputMatch = line.match(/^    input:\s*(.+)/);
    if (inputMatch) { currentStep.input = inputMatch[1].trim().replace(/^['"]|['"]$/g, ''); continue; }

    const outputMatch = line.match(/^    output:\s*(.+)/);
    if (outputMatch) { currentStep.output = outputMatch[1].trim().replace(/^['"]|['"]$/g, ''); continue; }

    const descStepMatch = line.match(/^    description:\s*(.+)/);
    if (descStepMatch) { currentStep.description = descStepMatch[1].trim().replace(/^['"]|['"]$/g, ''); continue; }
  }

  if (currentStep && currentStep.agent) result.steps!.push(currentStep as WorkflowStep);

  if (!result.name) throw new Error('Workflow YAML must have a "name" field');
  if (!result.steps || result.steps.length === 0) throw new Error('Workflow YAML must have at least one step');

  return result as WorkflowDefinition;
}

/** Validate a workflow definition. Returns list of errors, empty = valid. */
export function validateWorkflow(wf: WorkflowDefinition): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];
  const knownOutputs = new Set<string>();

  for (let i = 0; i < wf.steps.length; i++) {
    const step = wf.steps[i];
    if (!step.agent) {
      errors.push({ step: i, field: 'agent', message: `Step ${i + 1} is missing required "agent" field` });
    }
    if (step.input && !knownOutputs.has(step.input)) {
      errors.push({
        step: i,
        field: 'input',
        message: `Step ${i + 1} references input "${step.input}" which is not produced by any prior step`,
      });
    }
    if (step.output) knownOutputs.add(step.output);
  }

  return errors;
}

/** Build a human-readable execution plan for the workflow. */
export function buildWorkflowRunPlan(wf: WorkflowDefinition, dryRun = false): WorkflowRunPlan {
  return {
    workflow: wf,
    dryRun,
    steps: wf.steps.map((step, i) => ({
      index: i + 1,
      agent: step.agent,
      inputFrom: step.input,
      outputAs: step.output,
      prompt: buildStepPrompt(step, i),
    })),
  };
}

function buildStepPrompt(step: WorkflowStep, index: number): string {
  const parts: string[] = [`Step ${index + 1}: Invoke agent \`${step.agent}\``];
  if (step.input) parts.push(`with input from \`${step.input}\``);
  if (step.output) parts.push(`and save output as \`${step.output}\``);
  if (step.description) parts.push(`— ${step.description}`);
  return parts.join(' ');
}

/** Format a run plan as Markdown for display in chat or CI. */
export function formatRunPlan(plan: WorkflowRunPlan): string {
  const lines: string[] = [
    `## Workflow: ${plan.workflow.name}`,
    plan.workflow.description ? `\n> ${plan.workflow.description}` : '',
    plan.dryRun ? '\n**Dry-run mode** — showing chain without executing steps.' : '',
    '',
    '### Steps',
    '',
  ];

  for (const step of plan.steps) {
    lines.push(`${step.index}. **${step.agent}**`);
    if (step.inputFrom) lines.push(`   - Input: \`${step.inputFrom}\``);
    if (step.outputAs) lines.push(`   - Output: \`${step.outputAs}\``);
    lines.push(`   - ${step.prompt}`);
    lines.push('');
  }

  if (!plan.dryRun) {
    lines.push('### Execution');
    lines.push('');
    lines.push('To execute this workflow, invoke each agent in sequence, passing the output of each step as context to the next.');
    lines.push('Use the `dispatching-parallel-agents` or `executing-plans` skill for multi-agent orchestration.');
  }

  return lines.filter(l => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}

/** List all workflow files in a project. */
export function listWorkflows(cwd: string): string[] {
  const dir = path.join(cwd, '.github', 'ai-os', 'workflows');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
}

/** Load and parse a workflow by filename. */
export function loadWorkflow(cwd: string, filename: string): WorkflowDefinition {
  const filepath = path.join(cwd, '.github', 'ai-os', 'workflows', filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Workflow file not found: ${filepath}`);
  }
  const content = fs.readFileSync(filepath, 'utf8');
  return parseWorkflowYaml(content);
}
