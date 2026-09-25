# Refresh the two fork features before each sync

These are additional mandatory sources, independent of the open authored PR list:

- `jakeleventhal:feat/chat-pseudo-project`
- `jakeleventhal:t3code/group-sidebar-threads-by-worktree`

Their upstream base is `pingdotgg/t3code:t3code/codex-turn-mapping`, the
orchestrator V2 branch. Never rebase them onto `main` during this preview workflow.
A full sync authorizes updating these two fork branches and publishing each with
an explicit force-with-lease against its captured old remote SHA.

## Freeze the input to this refresh

After fetching remotes, save these files once in the current `SYNC_RUN`:

```bash
git rev-parse upstream/t3code/codex-turn-mapping > "$SYNC_RUN/orchestrator-v2.sha"
printf '%s\n' feat/chat-pseudo-project t3code/group-sidebar-threads-by-worktree \
  > "$SYNC_RUN/feature-branches.txt"
while IFS= read -r branch; do
  printf '%s\t%s\n' "$branch" "$(git rev-parse "origin/$branch")"
done < "$SYNC_RUN/feature-branches.txt" > "$SYNC_RUN/features-before.tsv"
```

Resume with these captured inputs. If an upstream push happens during a run,
finish this snapshot; the next new full sync fetches again. Do not silently
replace a concurrent feature branch edit or overwrite the snapshot.

## Rebase and verify each branch

Inspect `git worktree list --porcelain`, branch history, and local divergence.
Preserve local edits and commits. Use a separate temporary worktree/branch for
each rebase so the running personal installation and other feature worktrees
remain intact. The scratch branch starts at the captured remote feature head.

Find the previous V2 base with `git merge-base "$old_sha" "$v2_sha"` and inspect
`git log --oneline "$old_base..$old_sha"` before rebasing. The range must contain
only that feature. If upstream rewrote V2 history, use the previous run's recorded
V2 base (or verified fork-point) rather than replaying upstream commits as a
feature. Stop and inspect an ambiguous range; never guess a base or drop commits.

In the scratch worktree, run `git rebase --onto "$v2_sha" "$old_base"`. If already
based on that exact V2 head, no history change is needed. Resolve conflicts
against the current V2 contracts and APIs, preserving both the feature and new
upstream behavior. Do not resurrect V1 orchestration. Keep feature commits in a
linear range above the V2 base; do not merge the entire V2 branch into the feature.

Validate the changes in each scratch worktree with `vp i`, focused tests and
relevant package typechecks. For Chat, verify idempotent startup creation, project
kind propagation, and web/mobile workspace controls. For worktree grouping,
verify Home and thread navigation on mobile, web grouping, per-thread actions,
shared terminal/preview/panel state, and final-sibling cleanup. CLI tests are
authorized; browser/device interaction still needs separate authorization.

Publish the validated scratch HEAD to its original remote branch:

```bash
git push origin "HEAD:refs/heads/$branch" \
  "--force-with-lease=refs/heads/$branch:$old_sha"
```

Verify `git ls-remote origin "refs/heads/$branch"` equals that HEAD. Append a row
to `features-final.tsv` only after verification, with four tab-separated columns:
`branch`, `old remote SHA`, `new feature SHA`, `frozen V2 SHA`. Record validation
and conflict adaptations alongside it. Both required rows must exist before
rebuilding personal. A lease rejection means someone else changed the branch;
preserve that work and reconcile it explicitly rather than force-pushing again.

## Include the features in the preview build

The chosen release commit and latest V2 development head can differ. Apply only
`v2_sha..feature_sha` from each refreshed branch to the selected preview source.
Do not merge the feature branch wholesale: that would advance the entire build
to unreleased V2 while stamping it with the older preview version.

Record original feature commits and their resulting cherry-picks/ports in the
run receipt. If a feature now depends on unreleased V2 APIs, adapt the feature
patch to the preview, with focused validation; do not silently drop it or change
the selected release. If upstream already implements a feature, verify the
behavior before recording its patch as superseded.

Query open authored PRs after refreshing the branches. Derive
`prs-to-integrate.tsv` from the frozen PR snapshot by excluding only rows whose
head repository owner is `jakeleventhal` and head ref is one of these two names
(or whose head is exactly a recorded feature SHA). Preserve excluded rows in
the receipt as included via the feature port. Copy every other row unchanged;
with no duplicates, `prs-to-integrate.tsv` is identical to `prs.tsv`.
