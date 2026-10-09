# 0022. Stamping a version on master releases it

**Date:** 2026-10-09
**Status:** accepted

## Context

A release was three acts done by hand after a merge: create the tag on the merge commit, copy the
version's changelog section into a GitHub release, mark it Latest. The acts stopped being done.
Tags `v2.41.8` to `v2.41.18` sit on their merge commits. On 2026-10-09 `VERSION` was 2.41.39 and
the twenty-one versions after 2.41.18 had no tag.

Nothing failed when that happened, and three things were wrong. The releases page named 2.41.18 as
Latest. A version could not be addressed by tag, and `/site-sync` reads `git log v<was>..HEAD` to
find what changed since the site was last synced. The changelog's link references pointed at
release pages that did not exist.

Two pieces were already in place. `VERSION` has one home and `node tools/cortex-version.mjs` fails
when a site disagrees with it ([ADR 0013](0013-the-version-has-one-home.md)).
`tools/cortex-release-notes.mjs` prints one version's changelog section or refuses. What was
missing was the act. The design is
[the release and drift-agent spec](../specs/2026-10-09-release-and-drift-agent-design.md), which
holds the GitHub docs sentence behind each claim here.

## Decision

**A push to `master` that raises `VERSION` is released by `.github/workflows/release.yml`.** Nobody
runs a script. Merging a stamped pull request is the release.

- The workflow runs on every push to `master` and compares `VERSION` at the commit before the push
  with `VERSION` at the pushed commit. Equal: it prints "VERSION unchanged" and stops.
- The tag `v<version>` goes on the pushed commit, by SHA. For a merged pull request that is the
  merge commit, the tree that was reviewed under that version.
- The release's title is the tag and its notes are that version's changelog section.
- Before anything is created the job requires that every version site agrees and that the notes
  extract. A failure there fails the job and creates nothing.
- A tag already on the remote ends the run with exit 0. A re-run does nothing.
- Latest is stated on every release: `--latest` when the version is above every `v<x.y.z>` tag on
  the remote, `--latest=false` otherwise. After creating, the job reads the releases again and
  puts Latest on the highest one.
- The job holds `GITHUB_TOKEN` with `contents: write` and nothing else. It uses no secret.

**The decisions live in `tools/cortex-release-plan.mjs`, not in the workflow's shell.** A workflow
cannot be run before it is pushed. The script prints `action=none`, `exists` or `release`, and
`tools/test/release-plan.test.sh` runs it on scratch repos with a bare repo as the remote. The
workflow's steps act on what it prints.

**The versions with no tag are back-filled by hand, once.** The loop is in the spec, under "The
twenty untagged versions". Every release in it says `--latest=false` and its last line names
Latest, so it is safe before or after a workflow release. Each run of the workflow prints the
versions that have a changelog section and no tag.

## Alternatives rejected

| Option | Why not |
|---|---|
| A `paths: [VERSION]` filter on the trigger | A path filter has documented cases where the workflow runs anyway or does not run, and a run skipped by a filter leaves no log saying why. The job's own comparison is needed either way. |
| Release when a tag is pushed | Somebody still has to create the tag on the right commit, which is the act that stopped being done. |
| Let GitHub choose Latest | The API marks every new release Latest. The CLI chooses by date and version. Neither is right for a back-filled release or for the slower of two runs. |
| Pass the branch name as the target | `master` may have moved by the time the job runs, and the tag would land on a commit nobody reviewed under that version. |
| Push the tag with git, then create the release on it | Two requests. A failure between them leaves a tag with no release, and the next run then stops at the tag. One request creates both or neither. |
| A concurrency group | A group cancels the older pending run. Three quick merges would lose the middle release. The tag check makes concurrent runs safe instead. |
| A personal token, so the release event starts other workflows | Nothing depends on that event. `site-drift.yml` is started by the same push. A standing token is a cost with no use. |
| A back-fill mode in the workflow | It would be a workflow able to tag any old commit, kept for one use. |
| Keep the comparison in the workflow's shell | It could then be tested only by pushing to `master`. |
| Tags with no releases for the old versions, or a release for the newest only | The first leaves a gap of twenty-one versions on the releases page. The second leaves them unaddressable by tag. |

## Consequences

- **A version stamped on `master` is public within minutes.** There is no step between the merge
  and the release, so the review of a stamped pull request is the review of the release.
- **Undoing a release is manual.** Delete the release and the tag by hand. Do not re-run that
  commit's workflow run afterwards: it would find no tag and create it again. The way forward is a
  new stamped version.
- **A stamped merge the job refuses is not released later by itself.** The fix lands in a push
  that leaves `VERSION` alone, and that push plans nothing. Release that version by hand, or stamp
  the next one. `version-sites.test.sh` and `release-notes.test.sh` fail the pull request for the
  two refusals a contributor can cause, which is what keeps this rare.
- **A push that lowers `VERSION` turns the run red.** Reverting a stamped merge does that. The run
  releases nothing and the red mark is the report.
- **A push that carried several stamped merges releases only its tip.** The run names the others.
- **The first merge after this lands that raises `VERSION` is the first release cut this way.** It
  takes Latest from 2.41.18. The versions between them stay untagged until the back-fill, and
  having no tag they have no say in Latest.

## Not yet run

The workflow file has never run. `tools/cortex-release-plan.mjs` is tested; these are not, and the
first real release shows each of them.

- **The YAML itself.** It was read against the workflow syntax and against the other workflows
  here. No parser has read it.
- **Whether `gh release create --target <sha>` with `GITHUB_TOKEN` is refused for a commit that
  differs from the default branch in a file under `.github/workflows/`.** The docs say the token
  must be authorized for workflows in that case and that `GITHUB_TOKEN` cannot be. The job tags
  the commit that started it, which is the tip of `master` unless a later push arrived first, so
  the case needs a second push that touched a workflow file within the minute the job takes.
  Whether an older commit of the default branch counts at all is not stated. If it is refused, the
  job fails and nothing was created, because the tag and the release are one request. Cut that
  version by hand:
  `gh release create v<x.y.z> --target <sha> --title v<x.y.z> --notes-file <notes> --latest`.
- **That the push event's `before` is the previous tip of `master` for a pull request merged from
  the web.** The docs say it is the most recent commit on the ref before the push.
- **The `gh` on the runner.** The job uses `gh release list --json tagName`, `--exclude-drafts`
  and `--exclude-pre-releases`, and `gh release view --json`.
- **A plan line with an empty value**, `untagged=`, appended to `$GITHUB_OUTPUT`.
