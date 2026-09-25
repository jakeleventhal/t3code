# Personal T3 sync

The workflow is now the repo-local [t3-sync skill](.agents/skills/t3-sync/SKILL.md).
Invoke `$t3-sync` or say "run the sync workflow". "Run the SYNC.md workflow" remains
an alias: read that skill and follow it.

Each new run selects the latest published V2 preview, freezes its source and
version, integrates Jake's open authored PRs and fork customizations, and builds/deploys desktop, physical
iPhone, and the matching remote server. Editing this file or the skill does not
start a sync.

Regular runs preserve the existing V2 databases.
The [main-based workflow note](.agents/skills/t3-sync/references/after-v2-on-main.md)
explains how to remove the preview workaround after V2 lands on main.

`personal-sync` remains the workflow-only tag. Its single commit above the
selected base contains this pointer and `.agents/skills/t3-sync/**`, never the
integrated product changes.
