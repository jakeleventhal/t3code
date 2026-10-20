# Source sync

Run from `/Users/jakeleventhal/Developer/t3code`. Use Bash for the snippets.
Each new run freezes main, a published Nightly version, open authored PRs, and
four retained closed PRs. Prepare and publish the rebased source branches, then
freeze their resulting heads. Resume that snapshot without selecting sources again.

## Freeze before resetting

Verify origin is Jake's fork and upstream is pingdotgg/t3code. Inspect status,
worktrees, and local/remote personal history. Preserve uncommitted work and a
backup ref for the old personal tip. Do not automatically replay the old
personal-integration-fixes commit: preview compatibility glue is no longer part
of the source recipe. Keep required iPhone signing support as described below.

```bash
set -eu
git fetch origin --prune
git fetch upstream --prune --tags
git fetch origin '+refs/tags/personal-sync:refs/tags/personal-sync'
mkdir -p .t3/personal-sync
SYNC_RUN=$(mktemp -d "$PWD/.t3/personal-sync/run.XXXXXX")
printf '%s\n' "$SYNC_RUN" > .t3/personal-sync/current-run
BASE_SHA=$(git rev-parse upstream/main)
python3 .agents/skills/t3-sync/scripts/select-nightly.py \
  --base-sha "$BASE_SHA" --output "$SYNC_RUN/release.json"
RELEASE_TAG=$(jq -r .tag "$SYNC_RUN/release.json")
RELEASE_VERSION=$(jq -r .version "$SYNC_RUN/release.json")
gh pr list --repo pingdotgg/t3code --author jakeleventhal --state open \
  --limit 1000 --json number,headRefOid,headRefName,headRepository,headRepositoryOwner,title,url \
  > "$SYNC_RUN/open-prs.json"
```

Record absolute SYNC_RUN in the progress report. The selector chooses the newest
published Nightly whose release commit is reachable from frozen main. base_sha
is main; release_sha identifies the version-stamping release. Do not reset to
that release tag instead of main. All targets are rebuilt from integrated source.

Include drafts. If the open-PR query reaches its limit, paginate before freezing.
Create original-open-prs.tsv in ascending PR order with number and starting head
SHA. Fetch each
`refs/pull/<number>/head` into `refs/remotes/personal-sync/pr/<number>` and verify
it equals the recorded SHA. If a head moved, fetch the frozen SHA directly or
restart selection in a new run directory only before source preparation begins.
After any source has been published, resume the recorded run instead.

Read [retained-prs.md](retained-prs.md). Snapshot those four PRs separately in
retained-prs.json / original-retained-prs.tsv, including metadata and starting
source SHAs. Deduplicate
by PR number or identical head, recording inclusion through the open set. Do not
refresh unrelated feature branches. Only the selected Jake-owned source branches
are rebased as described below.

If main and the selected PRs do not provide Jake's full iPhone signing configuration,
freeze origin/personal-ios-capabilities in ios-capabilities.sha. This is only
build support for Jake's existing bundle identity, notifications, and Live
Activities, including development APNs for the widget extension; do not bring
back unrelated preview reconciliation. Bundle-ID support alone is not enough:
use the resolved-config and generated-entitlement checks in [iphone.md](iphone.md).

The validated support branch contains the app capability adaptation
`55160691ce4c5bc425a1374dbe03698a82333b56` and the widget sandbox APNs adaptation
`c814d321f1863949f70ff75fbb5645385bf69017`. Freeze the current branch head, inspect
its changes, and carry only the still-required support commits or equivalent
patches into personal. Do not merge the branch's unrelated old integration
history. If an included widget PR supplies the plugin, apply its personal-team
entitlement adaptation after that PR, preserving the current plugin's behavior.

## Preserve personal background delivery support

Always freeze `origin/personal-background-delivery-fix`, even though it has no
upstream PR. Its product patch range starts after
`b162bc86f925a527f14f16dbfdc63289b5049b46`; that base is historical integrated
personal, so do not merge the entire branch or rebase all its ancestors. Record
the frozen head and inspect `git log --reverse --no-merges <base>..<head>`.
Replay only the product commits in that range after the selected PRs and iPhone
capability support. Workflow-only edits are carried by the `personal-sync` tag.
Persist any required compatibility fixes on this same dedicated source branch
and update the frozen head before integration. Verify the private routing,
widget backend, and APNs worker remain present after conflict resolution.
This support depends on the native widget refresh/backend feature maintained on
`origin/t3code/agent-widget-background-refresh-v2` (PR #14861). Freeze and include
that source whenever upstream does not yet contain its complete widget API,
shared-keychain credentials, timeline fetcher, and WidgetKit push registration.
Deduplicate it if already selected as an open PR. If the PR closes unmerged,
retain this dependency as required personal build support instead of silently
omitting it. Its validated head for this repair was
`a3260ae0ee930d4a39785c8b30795fbc92c46416`; discover the current maintained head
on each new run and prepare it using the source-branch procedure below.

Follow [background-delivery.md](background-delivery.md) before deployment.

## Preserve the mobile startup repair

Freeze `origin/personal-mobile-startup-fix` while upstream still dynamically imports
`react-native` in `apps/mobile/src/features/updates/app-updates.ts`. Metro's namespace
import enumerates React Native's lazy exports, including unavailable legacy native
modules, and crashes the signed Release app during startup. Rebase this dedicated
source onto frozen main and replay its narrow product patch after the selected PRs.
If main already imports only the needed `AppState` export, verify the equivalent
before retiring this support source. Keep the repair separate from unrelated PRs.

## Prepare source branches before rebuilding personal

Rebase each unique selected source branch onto the same `BASE_SHA` before any
personal reset or merge. Resolve upstream conflicts in that source branch and
publish the result to Jake's fork, so subsequent syncs reuse the resolution.
Do not leave an upstream conflict fix solely on personal. An already-rebased
head with `BASE_SHA` as an ancestor needs no history rewrite.

For open PRs, use their actual fork head branch and require the fetched fork
head to equal the frozen GitHub head. For retained closed PRs, use the maintained
fork branch described in [retained-prs.md](retained-prs.md), rather than restoring
the historical PR ref on every run. Verify the owner/repository matches Jake's
fork. Save each observed remote branch SHA for the push lease and a backup ref
before rebasing. A deleted retained source branch may be recreated from its
frozen PR head with an explicit empty lease.

Use an isolated, detached worktree for preparation; do not reset a source branch
that is checked out in another active worktree. For a normal source branch:

```bash
set -eu
PR_WORKTREE="$SYNC_RUN/rebase/pr-$PR_NUMBER"
mkdir -p "$SYNC_RUN/rebase"
git worktree add --detach "$PR_WORKTREE" "$ORIGINAL_HEAD"
git -C "$PR_WORKTREE" rebase "$BASE_SHA"
# Resolve conflicts in this worktree, stage the affected files, and continue
# with git -C "$PR_WORKTREE" rebase --continue. Validate the feature afterward.
REBASED_HEAD=$(git -C "$PR_WORKTREE" rev-parse HEAD)
git merge-base --is-ancestor "$BASE_SHA" "$REBASED_HEAD"
git push origin "$REBASED_HEAD:refs/heads/$SOURCE_BRANCH" \
  "--force-with-lease=refs/heads/$SOURCE_BRANCH:$OBSERVED_REMOTE_HEAD"
# Verify that the fork branch and, for an open PR, its GitHub head now match.
```

Inspect branch history before rebasing. A retained branch may contain unrelated
old V2 integration history. Normalize it once
by replaying only its feature commits onto `BASE_SHA`, preserving all intended
web/mobile behavior, then publish that cleaned head to the same maintained
source branch. Record original commits, resulting commits, and adaptations.
Future runs rebase the cleaned branch; do not repeat a feature port from the old
closed PR snapshot. Do not restore preview glue or import unrelated features.

Save progress per source: original PR head, source branch, observed fork head,
backup ref, rebase base, resulting head, validation, and verified published head.
If a lease fails, fetch and reconcile the intervening source changes; never
overwrite them with an unconditional force push. If preparation is interrupted,
resume the recorded rebase or push instead of reselecting sources or starting
another run.

### Address PR comments before publishing each source

For every selected PR, including retained closed PRs, snapshot all unresolved
review threads and PR conversation/review comments at source preparation time.
Paginate the GitHub queries, including comments within threads; an outdated
thread is not necessarily resolved. Save IDs, URLs, timestamps, bodies, and the
reviewed commit with the source's run records. Review conversation comments and
review summaries for actionable feedback that is not represented by a thread.
Do not reopen already resolved discussions without new evidence.

Verify every open finding against the rebased source. Fix real findings on the
owning source branch, with focused tests where behavior changes. Preserve the
feature's intended behavior across relevant clients and providers. If a finding
is already fixed, superseded by upstream, duplicated, or incorrect, record the
specific source/test evidence and a concise disposition. Do not silently ignore
human or bot comments, accept a bot finding without verification, or resolve a
thread solely because its lines became outdated during rebase. A question or
requested product decision that cannot be answered from the existing scope is a
review blocker, not permission to invent a feature or omit the source.

Before the lease-protected push, refresh comments to catch feedback posted while
rebasing and verify that every open actionable item has a disposition and that
the final source head passes its focused checks. Freeze this review cutoff in
the run record. After publishing, reply to the reviewed comments with the fix
commit and validation or the evidence-backed reason no code change was needed;
resolve only threads whose requested work has actually been addressed. This
workflow authorizes those replies and resolutions on the selected PRs, not
unrelated PR moderation or new upstream PRs. Comments arriving after the cutoff
are recorded as later feedback for the next run unless the user asks to babysit.

Save a per-source comment ledger and a consolidated `pr-comments.md` in SYNC_RUN,
including explicit no-open-comments results, reviewed/published SHAs, cutoff,
fixes, checks, reply/resolution links, and unresolved blockers. A source with an
unaddressed actionable comment must not be pushed or integrated. Carry this gate
through resumes; earlier preparation without comment review is not sufficient.

Once every selected source is prepared, write final `open-prs.tsv` and
`retained-prs.tsv` in numeric order from those published heads. Keep the original
metadata for provenance. Fetch the published fork refs into this run's source
refs and verify the final frozen SHAs; closed PR refs need not match the updated
fork heads. Personal integration uses only these final manifests.

Rebasing onto main saves conflicts with upstream. Independent PRs can still
conflict with each other during integration; resolve those without copying one
feature into an unrelated PR. Persist a reusable fix on its owning source branch
when appropriate, and record any integration-only adaptation explicitly.

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

A stale PR's unrelated history must already have been removed during source
preparation, with the cleaned head published for reuse. If main already implements
a retained feature, verify its
behavior before recording it as superseded.

Apply frozen iPhone capability support only if needed. Keep necessary signing
adaptations on personal-ios-capabilities. Do not rewrite source branches again
during personal integration; use the prepared heads. The old orchestrator branch
refresh is retired.

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
