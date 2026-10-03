# Retained closed PRs

Include these five sources after all open PRs authored by jakeleventhal:

| PR | Feature |
| --- | --- |
| [#12268](https://github.com/pingdotgg/t3code/pull/12268) | Group threads and shared resources by worktree |
| [#9262](https://github.com/pingdotgg/t3code/pull/9262) | Render standalone media links inline |
| [#6514](https://github.com/pingdotgg/t3code/pull/6514) | Discover named dev server URLs, including Portless |
| [#8471](https://github.com/pingdotgg/t3code/pull/8471) | Open tapped terminal links on iOS and Android |
| [#8562](https://github.com/pingdotgg/t3code/pull/8562) | Show linked dev servers on mobile |

Snapshot each PR's metadata and head:

```bash
PR_NUMBER=12268 # repeat for each number in the table
gh pr view "$PR_NUMBER" --repo pingdotgg/t3code \
  --json number,state,headRefOid,headRefName,headRepositoryOwner,title,url
```

Fetch its
`refs/pull/<number>/head` from upstream and verify the frozen SHA before rebuilding
personal. Closed PRs remain explicit sources. A reopened PR is included once
through the open set.

Use these PR heads directly. Preserve mobile as well as web behavior when
resolving worktree grouping. Follow source-sync.md for stale-history ports or
features already implemented by main.
