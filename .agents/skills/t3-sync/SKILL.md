---
name: t3-sync
description: Rebuild Jake's personal T3 Code fork from upstream main plus all open jakeleventhal PRs and five retained closed PRs, then build and deploy the Nightly desktop on Jakebook, the physical iPhone app, and the R2-D2 server. Use for "run the sync workflow", "run SYNC.md", or a personal T3 rebuild. Editing this skill alone does not run the workflow.
---

# Personal T3 sync

Run from `/Users/jakeleventhal/Developer/t3code` on `personal`. Each new full run
freezes fetched `upstream/main`, the newest published Nightly reachable from it,
all open PRs authored by `jakeleventhal` (including drafts), and the five sources
in [retained-prs.md](references/retained-prs.md). Rebase the selected fork source
branches onto frozen main, resolve and publish their conflicts there, then freeze
the resulting heads for integration. Resume from that snapshot;
the next new run discovers sources again.

V2 now lives on main. After preparing the source branches, reset personal to the
frozen main commit, integrate open PRs first, then the five retained closed PRs,
and rebuild all targets with the
frozen Nightly version. The preview-release selection and orchestrator feature
branch refresh are retired. Preserve every environment's existing V2 database.

## Invocation and scope

An instruction to run authorizes the documented personal/main resets,
workflow tag update, selected Jake-owned source branch rebases and lease-protected
pushes, fork pushes, builds, installations, and service restarts.
Honor narrower requests such as "skip builds" or "desktop only". Preparing or
editing the workflow does not authorize executing a sync.

Preserve uncommitted work and commits before resetting. Do not develop product
features on personal, force-push unrelated branches, create upstream PRs,
or replace the personal build with an official binary. Browser/computer-use
verification needs separate authorization; CLI artifact, process, service, and
connection checks are part of the workflow.

## Run order

1. Read [source-sync.md](references/source-sync.md). Fetch and freeze main,
   Nightly metadata, and the selected PRs' starting heads. Rebase their source
   branches onto that main, resolve conflicts, validate, and push the updated
   heads with explicit leases. Freeze those heads before integration. Record the
   absolute run directory under ignored `.t3/personal-sync/` in the progress
   report. Identify the existing R2-D2 SSH/service configuration privately.
   Before resetting or replacing installations, record the installed desktop
   version, the previous personal source SHA, and any available installed source
   marker in `SYNC_RUN/settings-baseline.json`. Keep that baseline immutable when
   resuming. If the installed source cannot be established, record the uncertainty
   and use the installed release tag as the upstream comparison baseline.
2. Hard-reset personal to frozen main, restore the workflow-only commit,
   integrate all open PRs, then the retained closed PRs, with duplicates included
   once. Preserve required iPhone signing support, resolve conflicts, run focused
   validation, and push the completed source.
3. Preserve and validate [personal background delivery](references/background-delivery.md),
   including its private relay, publisher credentials, and iPhone build flag.
   Follow [desktop.md](references/desktop.md) and
   [iphone.md](references/iphone.md) to build the personal Nightly DMG and signed,
   self-contained Release iPhone app from the same integrated Git SHA, including
   signed app/widget profile checks. Follow [remote.md](references/remote.md) to
   build the matching R2-D2 runtime. Prepare
   all artifacts before disrupting installations.
4. Deploy R2-D2, then install and launch desktop on Jakebook and the app on Jake's
   iPhone. When activation can terminate the coordinator, use an independent
   shell with a durable log. Never kill by process pattern.
5. Verify installed desktop/bundled server versions, the desktop window, R2-D2's
   running version/source and connection, and iPhone installation/launch. Verify
   mobile interaction when authorized; a running process does not prove protocol
   compatibility. Resume only the blocked step after unlock or reconnection.

Keep release manifests clean after builds. Finish with main SHA, Nightly tag and
release SHA, integrated SHA, PR inclusion results, validation, DMG and `.app`
paths, R2-D2 status, and unverified behavior. Do not claim completion while a
required artifact or deployment is missing.

Every run must also report all user-facing settings options and settings behavior
changes between the baseline installed build and the rebuilt source. Compare the
previous and final integrated trees, plus upstream changes between the installed
release and frozen main, so fork changes and upstream changes are both covered.
Inspect settings schemas, defaults, migrations, and web/desktop/mobile controls;
include additions, removals, renamed options, changed defaults, and changed
availability or behavior. Give the settings path, what changed, and any action
the user needs to take. Deduplicate changes already present in the old personal
build, distinguish client and provider availability, and state explicitly when
there are no changes. Save the evidence and full report in
`SYNC_RUN/settings-changes.md`, link it in the final reply, and summarize the
changes there. Do not claim interactive verification unless separately authorized.

## Durable workflow storage

Keep one personal branch and one movable personal-sync tag. The tag points to
exactly one commit above frozen upstream main, changing only `SYNC.md` and
`.agents/skills/t3-sync/**`. SYNC.md is a compatibility pointer to this skill.
The source-sync reference explains how to prepare that commit using an alternate
Git index without resetting the checkout. Workflow edits belong in the tag;
product changes belong on PR branches or required iPhone capability support.
