// The scheduled sync a team-brain runs (#624, R18): `templates/team-brain/sync.yml`, filled for
// this team and written to `.github/workflows/cortex-sync.yml` in the brain.
//
// Provisioning prints before it installs (docs/adr/0009): `render` returns the text, and only
// `writeSyncWorkflow` — reached by an explicit `--write` flag — puts it in the repo. A workflow is
// code that runs on a schedule with the team's tracker secrets, so nobody gets one by typing the
// obvious command.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource, cloneUrl, DEFAULT_SOURCE } from "../../core/source.js";
import { openVault } from "./vault.js";
import { VERSION } from "./version.js";
import { readIntegrations, IntegrationError } from "./integrations.js";
import { readTeamSource } from "./team.js";

const INSTALL_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // mcp/lib/ → repo root
export const TEMPLATE = join(INSTALL_DIR, "templates", "team-brain", "sync.yml");
export const WORKFLOW_REL = ".github/workflows/cortex-sync.yml";

/** The secrets each tracker's step reads, as `ENV: ${{ secrets.NAME }}` lines. */
const SECRETS = {
  github: [["GH_TOKEN", "CORTEX_GITHUB_TOKEN"]],
  servicenow: [["SERVICENOW_TOKEN", "SERVICENOW_TOKEN"], ["SERVICENOW_USER", "SERVICENOW_USER"], ["SERVICENOW_PASSWORD", "SERVICENOW_PASSWORD"]],
  jira: [["JIRA_EMAIL", "JIRA_EMAIL"], ["JIRA_API_TOKEN", "JIRA_API_TOKEN"]],
};

/**
 * The workflow text for a team.
 *
 * @param {{ kinds: string[], source?: string|null, profile: string, ref?: string }} opts
 *   `source` is the team's Cortex fork (team.json, #622), `profile` the one the job declares.
 */
export function renderSyncWorkflow({ kinds, source = null, profile, ref = `v${VERSION}` }) {
  if (!kinds.length) throw new IntegrationError("no integration is selected, so there is nothing for a scheduled sync to do");
  const url = cloneUrl(parseSource(source ?? DEFAULT_SOURCE, "the team's Cortex source"));
  if (!url) throw new IntegrationError("the team's Cortex source is a directory on one machine; a runner cannot clone it. Set an owner/repo or a git URL as the source first.");
  // `lab` syncs nothing by design, so a job declaring it would run and do nothing, forever.
  const declared = profile === "lab" ? "work" : profile;
  const env = kinds.flatMap((k) => SECRETS[k]).map(([v, s]) => `          ${v}: \${{ secrets.${s} }}`).join("\n");
  return readFileSync(TEMPLATE, "utf8")
    .replaceAll("{{CORTEX_REPO}}", url)
    .replaceAll("{{CORTEX_REF}}", ref)
    .replaceAll("{{CORTEX_PROFILE}}", declared)
    .replaceAll("{{TRACKER_ENV}}", env);
}

/** The workflow for the team-brain cloned at `clone`, from its own team.json. */
export function syncWorkflowFor(clone, { profile }) {
  const { kinds } = readIntegrations(clone);
  return renderSyncWorkflow({ kinds, source: readTeamSource(clone), profile });
}

/** Write it into the clone. Committing is the caller's. Returns the path relative to the clone. */
export function writeSyncWorkflow(clone, text) {
  openVault(clone).write(WORKFLOW_REL, text);
  return WORKFLOW_REL;
}
