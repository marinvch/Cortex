#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { enforceSkillContract, validateSkillContract } from './skill-contract.js';
import { enforceAgentContract, validateAgentContract } from './agent-contract.js';
import { SEVERITY_LEVELS } from './review-severity.js';

interface SmokeCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

interface ScorecardWeek {
  weekStart?: string;
}

interface ScorecardFile {
  weeks?: ScorecardWeek[];
}

// After the engine/ subtree move, two roots diverge:
//  - ENGINE_ROOT (engine/): engine source, templates, and the cwd for `npm run` (package.json lives here).
//  - REPO_ROOT (repo root): the repo's self-dogfooding data under .github/cortex/ (stayed at root).
// This file is at engine/src/validation/, so engine/ is two levels up and the repo root is three.
const ENGINE_ROOT = path.resolve(import.meta.dirname, '../..');
const REPO_ROOT = path.resolve(ENGINE_ROOT, '..');

function runCommand(command: string, cwd: string): { ok: boolean; output: string } {
  const result = spawnSync(command, {
    shell: true,
    cwd,
    encoding: 'utf-8',
    timeout: 60_000,
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return {
    ok: result.status === 0,
    output,
  };
}

function checkFileExists(relativePath: string, base: string = REPO_ROOT): SmokeCheck {
  const fullPath = path.join(base, relativePath);
  const passed = fs.existsSync(fullPath);
  return {
    name: `file exists: ${relativePath}`,
    passed,
    detail: passed ? undefined : `Missing file at ${fullPath}`,
  };
}

function checkPersistentRules(): SmokeCheck {
  const configPath = path.join(REPO_ROOT, '.github/cortex/config.json');
  if (!fs.existsSync(configPath)) {
    return {
      name: 'persistent rules configured',
      passed: false,
      detail: `Missing config file: ${configPath}`,
    };
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as { persistentRules?: string[] };
  const rules = Array.isArray(parsed.persistentRules) ? parsed.persistentRules : [];

  return {
    name: 'persistent rules configured',
    passed: rules.length > 0,
    detail: rules.length > 0 ? undefined : 'persistentRules array is empty',
  };
}

function checkScorecardHasEntries(): SmokeCheck {
  const scorecardPath = path.join(REPO_ROOT, '.github/cortex/metrics/scorecard.json');
  if (!fs.existsSync(scorecardPath)) {
    return {
      name: 'scorecard has weekly entries',
      passed: false,
      detail: `Missing scorecard file: ${scorecardPath}`,
    };
  }

  const raw = fs.readFileSync(scorecardPath, 'utf-8');
  const parsed = JSON.parse(raw) as ScorecardFile;
  const weeks = Array.isArray(parsed.weeks) ? parsed.weeks : [];

  return {
    name: 'scorecard has weekly entries',
    passed: weeks.length > 0,
    detail: weeks.length > 0 ? undefined : 'No weekly entries in scorecard.json',
  };
}

function checkSkillTemplateContracts(): SmokeCheck {
  const templatesDir = path.join(ENGINE_ROOT, 'src/templates/skills');
  if (!fs.existsSync(templatesDir)) {
    return {
      name: 'skill templates satisfy contract sections',
      passed: false,
      detail: `Missing templates directory: ${templatesDir}`,
    };
  }

  const templateFiles = fs.readdirSync(templatesDir)
    .filter((name) => name.endsWith('.md'));

  const invalid: string[] = [];
  for (const templateFile of templateFiles) {
    const fullPath = path.join(templatesDir, templateFile);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const enforced = enforceSkillContract(content, { skillName: templateFile });
    const validation = validateSkillContract(enforced);
    if (!validation.valid) {
      invalid.push(`${templateFile} -> missing: ${validation.missingSections.join(', ')}`);
    }
  }

  return {
    name: 'skill templates satisfy contract sections',
    passed: invalid.length === 0,
    detail: invalid.length === 0 ? undefined : invalid.join(' | '),
  };
}

function checkAgentTemplateContracts(): SmokeCheck {
  const templatesDir = path.join(ENGINE_ROOT, 'src/templates/agents');
  if (!fs.existsSync(templatesDir)) {
    return {
      name: 'agent templates satisfy contract sections',
      passed: false,
      detail: `Missing templates directory: ${templatesDir}`,
    };
  }

  const templateFiles = fs.readdirSync(templatesDir)
    .filter((name) => name.endsWith('.md'));

  const invalid: string[] = [];
  for (const templateFile of templateFiles) {
    const fullPath = path.join(templatesDir, templateFile);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const enforced = enforceAgentContract(content, { agentName: templateFile });
    const validation = validateAgentContract(enforced);
    if (!validation.valid) {
      invalid.push(`${templateFile} -> missing: ${validation.missingSections.join(', ')}`);
    }
  }

  return {
    name: 'agent templates satisfy contract sections',
    passed: invalid.length === 0,
    detail: invalid.length === 0 ? undefined : invalid.join(' | '),
  };
}

function checkReviewSeverityTaxonomy(): SmokeCheck {
  const reviewTemplates = [
    'src/templates/agents/enhancement-advisor.md',
    'src/templates/agents/idea-validator.md',
  ];

  const missing: string[] = [];
  for (const relPath of reviewTemplates) {
    const fullPath = path.join(ENGINE_ROOT, relPath);
    if (!fs.existsSync(fullPath)) {
      missing.push(`${relPath} (file not found)`);
      continue;
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    const missingLabels = SEVERITY_LEVELS.filter(
      (level) => !content.includes(`**${level}**`) && !content.includes(level),
    );
    if (missingLabels.length > 0) {
      missing.push(`${relPath} missing labels: ${missingLabels.join(', ')}`);
    }
  }

  return {
    name: 'review severity taxonomy present in review templates',
    passed: missing.length === 0,
    detail: missing.length === 0 ? undefined : missing.join(' | '),
  };
}

function run(): void {
  const checks: SmokeCheck[] = [];

  checks.push(checkFileExists('.github/cortex/context/knowledge-vault.md'));
  checks.push(checkFileExists('.github/cortex/context/packs/implementation.md'));
  checks.push(checkFileExists('.github/cortex/context/templates/decision-note.md'));
  checks.push(checkFileExists('src/validation/scorecard.ts', ENGINE_ROOT));
  checks.push(checkFileExists('src/validation/scorecard-check.ts', ENGINE_ROOT));
  checks.push(checkPersistentRules());
  checks.push(checkScorecardHasEntries());
  checks.push(checkSkillTemplateContracts());
  checks.push(checkAgentTemplateContracts());
  checks.push(checkReviewSeverityTaxonomy());

  const scorecardCheck = runCommand('npm run scorecard:check', ENGINE_ROOT);
  checks.push({
    name: 'scorecard freshness command',
    passed: scorecardCheck.ok,
    detail: scorecardCheck.ok ? undefined : scorecardCheck.output,
  });

  const planCheck = runCommand('npm run generate -- --cwd . --plan', ENGINE_ROOT);
  checks.push({
    name: 'generator plan mode',
    passed: planCheck.ok,
    detail: planCheck.ok ? undefined : planCheck.output,
  });

  const previewCheck = runCommand('npm run generate -- --cwd . --preview', ENGINE_ROOT);
  checks.push({
    name: 'generator preview mode',
    passed: previewCheck.ok,
    detail: previewCheck.ok ? undefined : previewCheck.output,
  });

  const failed = checks.filter((c) => !c.passed);

  console.log('AI OS smoke test results:');
  for (const check of checks) {
    const icon = check.passed ? 'PASS' : 'FAIL';
    console.log(`- [${icon}] ${check.name}`);
    if (!check.passed && check.detail) {
      console.log(`  ${check.detail}`);
    }
  }

  if (failed.length > 0) {
    process.exit(1);
  }
}

try {
  run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke test failed: ${message}`);
  process.exit(1);
}
