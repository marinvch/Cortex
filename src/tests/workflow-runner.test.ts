import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseWorkflowYaml,
  validateWorkflow,
  buildWorkflowRunPlan,
  formatRunPlan,
  listWorkflows,
  loadWorkflow,
} from '../workflow-runner.js';

const FEATURE_PIPELINE_YAML = `
name: Feature Development Pipeline
description: Three-phase feature development

steps:
  - agent: ai-os — Feature Enhancement Advisor
    output: enhancement-report
    description: Scan for improvements

  - agent: ai-os — Idea Validator
    input: enhancement-report
    output: approved-work-order
    description: Validate report

  - agent: ai-os — Implementation Agent
    input: approved-work-order
    description: Implement changes
`;

describe('parseWorkflowYaml', () => {
  it('parses workflow name and description', () => {
    const wf = parseWorkflowYaml(FEATURE_PIPELINE_YAML);
    expect(wf.name).toBe('Feature Development Pipeline');
    expect(wf.description).toBe('Three-phase feature development');
  });

  it('parses steps with agent, input, output, description', () => {
    const wf = parseWorkflowYaml(FEATURE_PIPELINE_YAML);
    expect(wf.steps).toHaveLength(3);
    expect(wf.steps[0].agent).toBe('ai-os — Feature Enhancement Advisor');
    expect(wf.steps[0].output).toBe('enhancement-report');
    expect(wf.steps[1].input).toBe('enhancement-report');
    expect(wf.steps[1].output).toBe('approved-work-order');
    expect(wf.steps[2].input).toBe('approved-work-order');
  });

  it('throws on missing name', () => {
    const yaml = `
steps:
  - agent: my-agent
`;
    expect(() => parseWorkflowYaml(yaml)).toThrow('name');
  });

  it('throws on empty steps', () => {
    const yaml = `
name: Test
steps:
`;
    expect(() => parseWorkflowYaml(yaml)).toThrow('step');
  });

  it('parses minimal single-step workflow', () => {
    const yaml = `
name: Simple
steps:
  - agent: my-agent
    output: result
`;
    const wf = parseWorkflowYaml(yaml);
    expect(wf.steps).toHaveLength(1);
    expect(wf.steps[0].agent).toBe('my-agent');
  });
});

describe('validateWorkflow', () => {
  it('returns no errors for a valid workflow', () => {
    const wf = parseWorkflowYaml(FEATURE_PIPELINE_YAML);
    const errors = validateWorkflow(wf);
    expect(errors).toHaveLength(0);
  });

  it('reports error for step referencing unknown input', () => {
    const wf = parseWorkflowYaml(`
name: Bad Workflow
steps:
  - agent: step-one
    input: nonexistent-output
    output: result
`);
    const errors = validateWorkflow(wf);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].field).toBe('input');
    expect(errors[0].message).toContain('nonexistent-output');
  });

  it('reports error for step missing agent field', () => {
    const wf = {
      name: 'Bad Workflow',
      steps: [{ agent: '', output: 'result' }],
    };
    const errors = validateWorkflow(wf);
    expect(errors.some(e => e.field === 'agent')).toBe(true);
  });
});

describe('buildWorkflowRunPlan', () => {
  it('builds plan with correct step count', () => {
    const wf = parseWorkflowYaml(FEATURE_PIPELINE_YAML);
    const plan = buildWorkflowRunPlan(wf, true);
    expect(plan.steps).toHaveLength(3);
    expect(plan.dryRun).toBe(true);
  });

  it('assigns 1-based step indices', () => {
    const wf = parseWorkflowYaml(FEATURE_PIPELINE_YAML);
    const plan = buildWorkflowRunPlan(wf);
    expect(plan.steps[0].index).toBe(1);
    expect(plan.steps[2].index).toBe(3);
  });

  it('carries inputFrom and outputAs fields', () => {
    const wf = parseWorkflowYaml(FEATURE_PIPELINE_YAML);
    const plan = buildWorkflowRunPlan(wf);
    expect(plan.steps[1].inputFrom).toBe('enhancement-report');
    expect(plan.steps[1].outputAs).toBe('approved-work-order');
  });
});

describe('formatRunPlan', () => {
  it('includes workflow name', () => {
    const wf = parseWorkflowYaml(FEATURE_PIPELINE_YAML);
    const plan = buildWorkflowRunPlan(wf, true);
    const output = formatRunPlan(plan);
    expect(output).toContain('Feature Development Pipeline');
  });

  it('includes dry-run note when dryRun = true', () => {
    const wf = parseWorkflowYaml(FEATURE_PIPELINE_YAML);
    const plan = buildWorkflowRunPlan(wf, true);
    const output = formatRunPlan(plan);
    expect(output).toContain('Dry-run mode');
  });

  it('lists all agents in order', () => {
    const wf = parseWorkflowYaml(FEATURE_PIPELINE_YAML);
    const plan = buildWorkflowRunPlan(wf, false);
    const output = formatRunPlan(plan);
    expect(output.indexOf('Feature Enhancement Advisor')).toBeLessThan(output.indexOf('Idea Validator'));
    expect(output.indexOf('Idea Validator')).toBeLessThan(output.indexOf('Implementation Agent'));
  });
});

describe('listWorkflows and loadWorkflow', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'workflow-test-')); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns empty array when no workflows dir', () => {
    expect(listWorkflows(tmpDir)).toEqual([]);
  });

  it('lists workflow files', () => {
    const dir = join(tmpDir, '.github', 'ai-os', 'workflows');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'my-pipeline.yml'), FEATURE_PIPELINE_YAML);
    const wfs = listWorkflows(tmpDir);
    expect(wfs).toContain('my-pipeline.yml');
  });

  it('loads and parses a workflow file', () => {
    const dir = join(tmpDir, '.github', 'ai-os', 'workflows');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'feature-pipeline.yml'), FEATURE_PIPELINE_YAML);
    const wf = loadWorkflow(tmpDir, 'feature-pipeline.yml');
    expect(wf.name).toBe('Feature Development Pipeline');
    expect(wf.steps).toHaveLength(3);
  });

  it('throws when workflow file not found', () => {
    expect(() => loadWorkflow(tmpDir, 'nonexistent.yml')).toThrow('not found');
  });
});
