import path from 'node:path';
import type { AiOsConfig } from '../types.js';
import { writeIfChanged } from './utils.js';

interface GenerateWorkflowOptions {
  config?: AiOsConfig;
}

export function generateWorkflows(outputDir: string, options?: GenerateWorkflowOptions): string[] {
  const managed: string[] = [];
  const track = (p: string): string => {
    managed.push(p);
    return p;
  };

  if (options?.config?.updateCheckEnabled !== false) {
    const workflowPath = track(path.join(outputDir, '.github', 'workflows', 'ai-os-update-check.yml'));
    writeIfChanged(workflowPath, getUpdateCheckWorkflowContent());
  }

  return managed;
}

function getUpdateCheckWorkflowContent(): string {
  return `name: AI OS Update Check

on:
  schedule:
    - cron: '0 9 * * 1'
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  check-for-ai-os-updates:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Read installed and latest versions
        id: versions
        shell: bash
        run: |
          set -euo pipefail

          ENABLED=$(node -e "const fs=require('fs'); try { const c=JSON.parse(fs.readFileSync('.github/ai-os/config.json','utf8')); process.stdout.write(String(c.updateCheckEnabled !== false)); } catch { process.stdout.write('true'); }")
          echo "enabled=$ENABLED" >> "$GITHUB_OUTPUT"

          INSTALLED=$(node -e "const fs=require('fs'); try { const c=JSON.parse(fs.readFileSync('.github/ai-os/config.json','utf8')); process.stdout.write(c.version || '0.0.0'); } catch { process.stdout.write('0.0.0'); }")
          echo "installed=$INSTALLED" >> "$GITHUB_OUTPUT"

          LATEST=$(curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/dev/package.json | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{const j=JSON.parse(d); process.stdout.write(j.version||'0.0.0');});")
          echo "latest=$LATEST" >> "$GITHUB_OUTPUT"

          NEEDS_UPDATE=$(node -e "const a=process.argv[1].split('.').map(n=>parseInt(n,10)||0); const b=process.argv[2].split('.').map(n=>parseInt(n,10)||0); const lt=(x,y)=>x[0]<y[0]||x[0]===y[0]&&(x[1]<y[1]||x[1]===y[1]&&x[2]<y[2]); process.stdout.write(lt(a,b)?'true':'false');" "$INSTALLED" "$LATEST")
          echo "needs_update=$NEEDS_UPDATE" >> "$GITHUB_OUTPUT"

      - name: Create issue if update is available
        if: steps.versions.outputs.enabled == 'true' && steps.versions.outputs.needs_update == 'true'
        uses: actions/github-script@v7
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
          script: |
            const latest = '\${{ steps.versions.outputs.latest }}';
            const installed = '\${{ steps.versions.outputs.installed }}';
            const owner = context.repo.owner;
            const repo = context.repo.repo;
            const title = 'AI OS update available: v' + latest;

            const open = await github.paginate(github.rest.issues.listForRepo, {
              owner,
              repo,
              state: 'open',
              per_page: 100,
            });

            if (open.some((i) => i.title === title)) {
              core.info('Update issue already exists; skipping.');
              return;
            }

            await github.rest.issues.create({
              owner,
              repo,
              title,
              body: [
                'A newer AI OS version is available.',
                '',
                '- Installed: v' + installed,
                '- Latest: v' + latest,
                '',
                'To update, run:',
                'bash install.sh --refresh-existing',
              ].join('\n'),
            });
`;
}
