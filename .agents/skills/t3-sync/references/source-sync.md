# Source sync

Use Bash for these snippets. Each new run has one immutable release and source
snapshot. Do not re-query midway through conflict resolution.

## Select and snapshot before resetting

Verify `origin` is Jake's fork and `upstream` is `pingdotgg/t3code`. Inspect branch,
worktrees, and status. Preserve uncommitted changes and audit first-parent
non-merge commits on local and remote `personal`. Durable product changes must
already exist on `personal-ios-capabilities`, `personal-integration-fixes`, or an
included PR branch, or one of the two named feature branches below. Workflow-only commits may be represented by `personal-sync`.

```bash
git fetch origin --prune
git fetch upstream --prune
git fetch origin '+refs/tags/personal-sync:refs/tags/personal-sync'
git log --first-parent --no-merges --oneline upstream/main..personal
git log --first-parent --no-merges --oneline upstream/main..origin/personal
mkdir -p .t3/personal-sync
SYNC_RUN=$(mktemp -d "$PWD/.t3/personal-sync/run.XXXXXX")
python3 .agents/skills/t3-sync/scripts/select-preview.py --output "$SYNC_RUN/release.json"
BASE_SHA=$(jq -r .base_sha "$SYNC_RUN/release.json")
RELEASE_TAG=$(jq -r .tag "$SYNC_RUN/release.json")
RELEASE_VERSION=$(jq -r .version "$SYNC_RUN/release.json")
git fetch upstream "refs/tags/$RELEASE_TAG"
test "$(git rev-parse 'FETCH_HEAD^{commit}')" = "$BASE_SHA"
git rev-parse upstream/main > "$SYNC_RUN/upstream-main.sha"
```

Record `SYNC_RUN` in the progress report. On resume reload these variables from
that directory; never rerun selection. The script defaults to arm64; pass
`--desktop-arch x64` on Intel. Before activation check that `release.json` lists
the archive needed by the actual remote OS and CPU, plus `SHA256SUMS`.

Before querying PRs, follow [feature-branches.md](feature-branches.md) to refresh
`origin/feat/chat-pseudo-project` and
`origin/t3code/group-sidebar-threads-by-worktree` on one frozen latest
`upstream/t3code/codex-turn-mapping` head. This is required on every new full sync,
even when neither branch has an open PR. Do not start rebuilding `personal` until
both branch updates pass validation and their remote heads are verified.

Query open PRs once, including drafts. `--limit 1000` is intentional; if it hits
the limit, use a paginated query before freezing rather than truncating the set.

```bash
gh pr list --repo pingdotgg/t3code --author @me --state open \
  --limit 1000 --json number,headRefOid,headRefName,headRepositoryOwner,title,url > "$SYNC_RUN/open-prs.json"
jq -r 'sort_by(.number)[] | [.number,"upstream",("refs/pull/"+(.number|tostring)+"/head"),.headRefOid] | @tsv' \
  "$SYNC_RUN/open-prs.json" > "$SYNC_RUN/prs.tsv"
git rev-parse origin/personal-ios-capabilities > "$SYNC_RUN/ios-capabilities.sha"
git rev-parse origin/personal-integration-fixes > "$SYNC_RUN/integration-fixes.sha"
```

Include only open PRs authored by the authenticated GitHub user, including drafts.
The two named fork features are explicit additions to this dynamic PR set. Do not
append closed PRs or other retained PR numbers. An empty
open-PR snapshot is valid. Fetch every row to
`refs/remotes/personal-sync/pr/<number>` and verify it matches the recorded SHA
before resetting. If a fetch races with a source update, fetch the recorded SHA
directly when available; otherwise restart selection in a new run directory.
Freeze both fork customization heads too, not just PRs. Keep the two refreshed
feature heads and their V2 base in `features-final.tsv` as described in the feature
reference. If an open PR points to one of these same fork branches, keep it in
`open-prs.json` and record that its feature patch is included once; do not merge
that head again and accidentally import unreleased V2 history.

## Preserve the workflow-only commit

Use an alternate index to copy the workflow from the tag onto this run's base.
If editing the skill, first replace the workflow tag using the reviewed working
files in an alternate index; do not stage product code into it. The allowed paths
are exactly `SYNC.md` and `.agents/skills/t3-sync/**`.

```bash
(
set -eu
OLD_SYNC_TAG=$(git rev-parse personal-sync)
SYNC_INDEX_DIR=$(mktemp -d)
trap 'rm -f "$SYNC_INDEX_DIR/index"; rmdir "$SYNC_INDEX_DIR"' EXIT
export GIT_INDEX_FILE="$SYNC_INDEX_DIR/index"
git read-tree "$BASE_SHA"
git restore --source=personal-sync --staged -- SYNC.md .agents/skills/t3-sync
SYNC_TREE=$(git write-tree)
SYNC_COMMIT=$(git commit-tree "$SYNC_TREE" -p "$BASE_SHA" -m 'chore(personal): maintain sync skill')
test "$(git rev-parse "$SYNC_COMMIT^")" = "$BASE_SHA"
test "$(git rev-list --count "$BASE_SHA..$SYNC_COMMIT")" = 1
git diff-tree --no-commit-id --name-only -r "$SYNC_COMMIT"
# Inspect that output: only the allowed workflow paths may differ.
git tag -f personal-sync "$SYNC_COMMIT"
git push origin "refs/tags/personal-sync" \
  "--force-with-lease=refs/tags/personal-sync:$OLD_SYNC_TAG"
)
```

Verify the remote tag equals the local tag before resetting. Do not add recurring
workflow commits above PR merges. The initial conversion from the old `SYNC.md`
is a one-time workflow-only installation commit on `personal`; future rebuilds
discard that commit and restore the canonical tag instead.

## Rebuild and integrate

```bash
git push origin "$(cat "$SYNC_RUN/upstream-main.sha"):refs/heads/main" --force-with-lease
git checkout personal
git reset --hard "$BASE_SHA"
git cherry-pick personal-sync
git merge --no-edit "$(cat "$SYNC_RUN/ios-capabilities.sha")"
# Apply only the named features, not the unreleased V2 commits beneath them.
while IFS=$'\t' read -r branch old_sha feature_sha v2_sha; do
  git rev-list --reverse --topo-order "$v2_sha..$feature_sha" > "$SYNC_RUN/$(basename "$branch").commits"
  # Inspect the range first: only this branch's feature commits, no merge commits.
  while IFS= read -r feature_commit; do
    git cherry-pick "$feature_commit" || exit 1
  done < "$SYNC_RUN/$(basename "$branch").commits"
  # On conflict the shell exits. Resolve and resume this exact range before the next source.
done < "$SYNC_RUN/features-final.tsv"
# Resolve feature conflicts fully before starting the PR loop below.
while IFS=$'\t' read -r pr remote source_ref expected_sha; do
  # Before this loop, exclude duplicate feature-branch PR rows from prs.tsv into
  # prs-to-integrate.tsv, recording their inclusion by feature port in the receipt.
  if git merge-base --is-ancestor "$expected_sha" HEAD; then continue; fi
  git merge --no-edit "$expected_sha" || break
done < "$SYNC_RUN/prs-to-integrate.tsv"
```

The snippets show source order; execute each step with failure handling. A nested
`break` alone is not permission to continue to another source after a failed
cherry-pick. Stop at a conflict. Resolve it and continue every remaining row from
the same file. Compare intended feature behavior as well as Git ancestry;
conflict resolution must not resurrect V1 orchestration or remove V2 features.
Do not merge current `upstream/main` just to satisfy a stale V1 check. When a PR
head includes unrelated V1 main merges, port its feature commits onto V2 instead
of importing that history. Record the frozen head, original feature commits,
resulting commits, and compatibility changes in the run receipt.

Apply the pinned `personal-integration-fixes` commit last with `git cherry-pick`.
If the old commit needs V2 adaptation, preserve the revised reconciliation on
that named branch and record the replacement SHA in a separate integration
receipt without overwriting the initial snapshot. Keep it a single reconciliation
commit suitable for cherry-picking. Apple capability adaptations belong on
`personal-ios-capabilities`. Port upstream-intended changes on their feature
branches; do not force-push them without authorization. A required compatibility
fix may add an explicitly recorded source revision to the run; ordinary upstream
movement may not. Do not silently drop a PR because its code already moved.

## Validate and publish

Run `vp i` after the source changes. Test the actual personal behavior and affected
packages; no repo-wide checks. Preserve the intent of every selected open PR, both named features (including
mobile worktree grouping), and the Apple capability customization. Audit the integration commit for obsolete
compatibility code before applying it; it must not reintroduce excluded features.
Run focused tests for the actual merged changes and surviving personal fixes, then:

```bash
vp run --filter @t3tools/web --filter @t3tools/mobile typecheck
vp exec tsc --noEmit -p apps/server/tsconfig.json
git diff --check "$BASE_SHA...HEAD"
```

The legacy username bridge marked
`TODO(PERSONAL-BRANCH-REMOVE-AFTER-PR-8305)` stays until #8305 is merged AND the
remote runs a compatible server advertising `RemoteOpenTarget.username`.
Its removal still requires an explicit decision updating the integration commit,
its dedicated test, and this reference. A preview version string alone is not proof.

Check every snapshot SHA is represented or has a documented equivalent/port.
Save `git rev-parse HEAD` to `$SYNC_RUN/integrated.sha`, push `personal` with
`--force-with-lease`, and verify local/remote equality. Do not move the workflow
tag to the integrated merge tip.
