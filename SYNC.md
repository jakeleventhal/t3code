# Personal T3 sync

The workflow is the repo-local [t3-sync skill](.agents/skills/t3-sync/SKILL.md).
Invoke `$t3-sync` or say "run the sync workflow". "Run the SYNC.md workflow"
remains an alias: read that skill and follow it.

Each new run first rebases the selected Jake-owned source branches onto frozen
upstream main, resolves conflicts there, and publishes the updated heads with
explicit leases so the next sync reuses those resolutions. It then hard-resets
personal to that main, integrates all open PRs authored by jakeleventhal
(including drafts), then the
[five retained closed PRs](.agents/skills/t3-sync/references/retained-prs.md),
and builds with a frozen published Nightly version. Rebuild and deploy desktop
on Jakebook, Jake's physical iPhone app, and the matching R2-D2 server from the
same integrated source. Preserve existing V2 databases and required iPhone
signing support. Editing this file or the skill does not start a sync.

personal-sync remains the workflow-only tag. Its single commit above frozen
upstream main contains this pointer and .agents/skills/t3-sync/**, never the
integrated product changes.
