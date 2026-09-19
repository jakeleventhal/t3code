---
name: t3-sync
description: Rebuild Jake's personal T3 Code fork from the latest V2 preview release plus his open authored PRs and the Chat/worktree feature branches, then build and install the Mac desktop and physical iPhone apps and update his remote server. Use for "run the sync workflow", "run SYNC.md", or a personal T3 rebuild. Editing this skill alone does not run the workflow.
---

# Personal T3 sync

Run from `/Users/jakeleventhal/Developer/t3code` on `personal`. Each new full run
discovers the latest published V2 preview. Freeze its source commit, version, and
the refreshed Chat/worktree branches, open authored PR heads, and fork customization heads for that run. A resumed run uses its existing snapshot; the
next new invocation discovers releases again. Never permanently pin a preview
version in this skill or substitute `upstream/main` for the preview source.

Jake uses V2 only. Preserve each environment's existing V2 database on every sync. The eventual return to the main-based workflow means V2 on
`main`, not a return to V1. Keep one `personal` branch and one `personal-sync` tag.

## Invocation and scope

An instruction to run this workflow authorizes its documented personal/main
resets, workflow tag update, fork pushes, builds, installation, and service
restarts. Honor narrower requests such as "skip builds" or "desktop only".
Preparing or editing the workflow does not authorize executing a sync.

Preserve uncommitted work before resetting. Do not develop product features on
`personal`, force-push unrelated branches, create upstream PRs, or replace a
custom desktop build with an official binary. Ask before browser/computer-use
verification unless separately authorized. CLI artifact, process, service, and
connection checks are part of the workflow.

## Run order

1. Read [source-sync.md](references/source-sync.md). Fetch remotes, audit durable
   personal changes, select the release, refresh the two named feature branches on
   the latest orchestrator V2 head, and freeze all source heads. Record the
   absolute run directory under the ignored `.t3/personal-sync/` in your progress
   report so a resumed agent can find it. Identify the existing remote environment
   and SSH/service configuration without printing credentials.
2. Rebuild `personal` from the frozen preview commit plus the workflow-only commit,
   Apple capability changes, both named feature patches, custom PRs, and personal integration fixes. Resolve
   compatibility against V2 and run focused validation. Push the completed source.
3. Follow [desktop.md](references/desktop.md) to build the custom preview DMG.
   Follow [iphone.md](references/iphone.md) to build the self-contained Release
   iPhone app from the same source. Build both before disrupting installations.
4. Follow [remote.md](references/remote.md) to update the existing remote to the
   exact selected preview. Then install and launch the local desktop and iPhone
   artifacts. A service restart or desktop quit can terminate the coordinating
   agent: run activation from an independent shell with a durable log when
   the current session depends on that environment. Never kill by process pattern.
5. Verify the installed desktop and bundled server version, running remote
   version and connection, and iPhone installation/launch. Verify local and remote
   mobile interaction when authorized; process launch alone does not establish
   protocol compatibility. Keep unfinished checks explicit and resume only the
   blocked step after a phone unlock or remote reconnection.

Keep release manifests clean after builds. Finish with release tag/base SHA,
integrated Git SHA, source inclusion results, validation, DMG and `.app` paths,
remote status, and any unverified behavior. Do not claim completion while a
required artifact or remote deployment is missing. Do not silently skip a custom
feature because its V1 implementation conflicts with V2.

## Durable workflow storage

`personal-sync` is a movable tag, not a product branch. It must point to exactly
one commit above the selected base, changing only `SYNC.md` and
`.agents/skills/t3-sync/**`. `SYNC.md` is a compatibility pointer to this skill.
The source-sync reference explains how to rebuild this commit with an alternate
Git index without resetting the active checkout. Workflow edits belong in this
tag; code belongs on the named fork branches or PR branches.

For the eventual removal of the preview workaround, read
[after-v2-on-main.md](references/after-v2-on-main.md). Do not switch release modes
automatically just because a preview commit is an ancestor of `main`.
