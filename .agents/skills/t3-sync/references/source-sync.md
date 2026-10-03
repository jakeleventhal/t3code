# Source sync

Run from `/Users/jakeleventhal/Developer/t3code`. Use Bash for the snippets.
Each new run freezes main, a published Nightly version, open authored PRs, and
five retained closed PRs. Resume that snapshot without selecting sources again.

## Freeze before resetting

Verify origin is Jake's fork and upstream is pingdotgg/t3code. Inspect status,
worktrees, and local/remote personal history. Preserve uncommitted work and a
backup ref for the old personal tip. Do not automatically replay the old
personal-integration-fixes commit: preview compatibility glue is no longer part
of the source recipe. Keep required iPhone signing support as described below.

```bash
git fetch origin --prune
git fetch upstream --prune --tags
git fetch origin '+refs/tags/personal-sync:refs/tags/personal-sync'
mkdir -p .t3/personal-sync
SYNC_RUN=$(mktemp -d "$PWD/.t3/personal-sync/run.XXXXXX")
BASE_SHA=$(git rev-parse upstream/main)
python3 .agents/skills/t3-sync/scripts/select-nightly.py \
  --base-sha "$BASE_SHA" --output "$SYNC_RUN/release.json"
RELEASE_TAG=$(jq -r .tag "$SYNC_RUN/release.json")
RELEASE_VERSION=$(jq -r .version "$SYNC_RUN/release.json")
gh pr list --repo pingdotgg/t3code --author jakeleventhal --state open \
  --limit 1000 --json number,headRefOid,headRefName,headRepositoryOwner,title,url \
  > "$SYNC_RUN/open-prs.json"
```

Record absolute SYNC_RUN in the progress report. The selector chooses the newest
published Nightly whose release commit is reachable from frozen main. base_sha
is main; release_sha identifies the version-stamping release. Do not reset to
that release tag instead of main. All targets are rebuilt from integrated source.

Include drafts. If the open-PR query reaches its limit, paginate before freezing.
Create open-prs.tsv in ascending PR order with number and head SHA. Fetch each
`refs/pull/<number>/head` into `refs/remotes/personal-sync/pr/<number>` and verify
it equals the recorded SHA. If a head moved, fetch the frozen SHA directly or
restart selection in a new run directory before resetting.

Read [retained-prs.md](retained-prs.md). Snapshot those five PRs separately in
retained-prs.json / retained-prs.tsv, including metadata and head SHAs. Deduplicate
by PR number or identical head, recording inclusion through the open set. Do not
refresh or rebase fork feature branches as an extra step.

If main and the selected PRs do not provide Jake's iPhone signing configuration,
freeze origin/personal-ios-capabilities in ios-capabilities.sha. This is only
build support for Jake's existing bundle identity, notifications, and Live
Activities; do not bring back unrelated preview reconciliation.

## Preserve the workflow-only tag

personal-sync holds one commit above BASE_SHA, changing only SYNC.md and
.agents/skills/t3-sync/**. Use an alternate index so preparing the workflow
cannot reset the checkout or stage product code. Normally restore from the tag;
when editing, use reviewed working files including additions and deletions.

```bash
(
set -eu
OLD_SYNC_TAG=$(git rev-parse personal-sync)
SYNC_INDEX_DIR=$(mktemp -d)
trap 'rm -f "$SYNC_INDEX_DIR/index"; rmdir "$SYNC_INDEX_DIR"' EXIT
export GIT_INDEX_FILE="$SYNC_INDEX_DIR/index"
git read-tree "$BASE_SHA"
git restore --source=personal-sync --staged -- SYNC.md .agents/skills/t3-sync
# When preparing workflow edits, replace the restore above with:
# git add -A -- SYNC.md .agents/skills/t3-sync
SYNC_TREE=$(git write-tree)
SYNC_COMMIT=$(git commit-tree "$SYNC_TREE" -p "$BASE_SHA" \
  -m 'chore(personal): maintain sync skill')
test "$(git rev-parse "$SYNC_COMMIT^")" = "$BASE_SHA"
test "$(git rev-list --count "$BASE_SHA..$SYNC_COMMIT")" = 1
git diff-tree --no-commit-id --name-only -r "$SYNC_COMMIT"
# Inspect: only the allowed workflow paths may differ.
git tag -f personal-sync "$SYNC_COMMIT"
git push origin refs/tags/personal-sync \
  "--force-with-lease=refs/tags/personal-sync:$OLD_SYNC_TAG"
)
```

Verify the remote tag matches before resetting. Never point it to the integrated
product tip. Preparing local workflow edits alone does not run the sync.

## Rebuild personal

After preserving work and verifying every source head:

```bash
git push origin "$BASE_SHA:refs/heads/main" --force-with-lease
git checkout personal
git reset --hard "$BASE_SHA"
git cherry-pick personal-sync
```

Integrate every row of open-prs.tsv first, then every unique row of
retained-prs.tsv. Merge each frozen head with `git merge --no-edit <sha>`. An
ancestor of HEAD is already included: record it. Stop at any conflict, resolve
it, and resume that row before advancing. Never silently skip remaining sources.

A stale PR with unrelated history should contribute its feature commits rather
than importing that history. Record the original head/commits, resulting port,
and adaptations. If main already implements a retained feature, verify its
behavior before recording it as superseded.

Apply frozen iPhone capability support only if needed. Keep necessary signing
adaptations on personal-ios-capabilities. Do not force-push PR or retained feature
branches during a sync; the old orchestrator branch refresh is retired.

## Validate and publish

Run vp i, focused behavior tests, and affected package checks. Verify every PR's
intent across relevant clients/providers. No repo-wide checks. Validate shared
server/client contracts before building:

```bash
vp run --filter @t3tools/web --filter @t3tools/mobile typecheck
vp exec tsc --noEmit -p apps/server/tsconfig.json
git diff --check "$BASE_SHA...HEAD"
```

Record inclusion or a verified equivalent for every source. Save git rev-parse
HEAD to SYNC_RUN/integrated.sha, push personal with --force-with-lease, and verify
local/remote equality. All builds use this SHA and the frozen Nightly version.
Build-time version stamping must leave tracked manifests clean.
