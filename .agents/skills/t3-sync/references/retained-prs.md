# Retained closed PRs

Include these five sources after all open PRs authored by jakeleventhal:

| PR                                                       | Feature                                            |
| -------------------------------------------------------- | -------------------------------------------------- |
| [#12268](https://github.com/pingdotgg/t3code/pull/12268) | Group threads and shared resources by worktree     |
| [#9262](https://github.com/pingdotgg/t3code/pull/9262)   | Render standalone media links inline               |
| [#6514](https://github.com/pingdotgg/t3code/pull/6514)   | Discover named dev server URLs, including Portless |
| [#8471](https://github.com/pingdotgg/t3code/pull/8471)   | Open tapped terminal links on iOS and Android      |
| [#8562](https://github.com/pingdotgg/t3code/pull/8562)   | Show linked dev servers on mobile                  |

Snapshot each PR's metadata and head:

```bash
PR_NUMBER=12268 # repeat for each number in the table
gh pr view "$PR_NUMBER" --repo pingdotgg/t3code \
  --json number,state,headRefOid,headRefName,headRepository,headRepositoryOwner,title,url
```

Use the PR metadata to identify Jake's corresponding fork branch. Fetch and
freeze that branch's current head as the maintained source, keeping the original
GitHub PR head for provenance. If the branch no longer exists, fetch the frozen
`refs/pull/<number>/head` from upstream as its starting point and recreate the
same fork branch after source preparation. Do not assume a closed PR's pull ref
will follow later pushes to its source branch.

Rebase the maintained branch onto frozen upstream main, resolve conflicts,
validate, and push with an explicit lease before freezing the final integration
SHA. Future runs fetch that updated fork branch, preserving its conflict fixes
instead of replaying the historical closed PR head. Inspect and remove unrelated
old integration history during the first normalization; preserve the intended
feature and any relevant later fixes. Follow [source-sync.md](source-sync.md).

Closed PRs remain explicit sources. A reopened PR is included once through the
open set using its actual current head. Preserve mobile as well as web behavior
when resolving worktree grouping. Record verified behavior already implemented
by main as superseded instead of restoring duplicate code.
