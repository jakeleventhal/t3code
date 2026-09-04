# Personal fork sync

**Agent trigger:** if the user says to run this workflow or follow this file and rebuild (e.g.
“run the SYNC.md workflow”), execute **Agent checklist** end-to-end without asking for confirmation
on the documented `main`/`personal` resets, tag update, or pushes.

Keep `main` as a clean mirror of upstream. Run from `personal`, which stacks the fork-only
`origin/personal-ios-capabilities` customization branch, every open PR authored by the
authenticated GitHub user against `pingdotgg/t3code`, and the explicitly retained closed PR
sources in step 6 on top of upstream, then cherry-picks the fork-only
`origin/personal-integration-fixes` reconciliation commit.

`SYNC.md` lives only on `personal`. The `personal-sync` tag must always point at **one** commit whose sole change is this file on top of `upstream/main` (never a merge tip). Rebuilds cherry-pick that commit.

Persistent fork-only code must live on one of the two named fork branches, never only on
`personal`. Use `personal-ios-capabilities` for Apple signing/capability customization and
`personal-integration-fixes` for post-merge compatibility code and its focused tests. A rebuild
intentionally discards direct commits on `personal`, so move every durable fix to the appropriate
fork branch before step 3.

## Agent checklist

Do these in order:

1. Ensure remotes exist (`origin` = fork, `upstream` = `pingdotgg/t3code`). Fetch both, forcing
   the intentionally movable `personal-sync` tag to its current remote value:

   ```bash
   git remote get-url origin
   git remote get-url upstream
   git fetch origin --prune
   git fetch upstream --prune
   git fetch origin \
     '+refs/tags/personal-sync:refs/tags/personal-sync'
   ```

   Before resetting `personal`, audit its first-parent non-merge commits. Every durable code change
   shown here must already be represented by `personal-ios-capabilities` or
   `personal-integration-fixes`; stop and preserve anything else before continuing:

   ```bash
   git log --first-parent --no-merges --oneline upstream/main..origin/personal
   ```

2. Sync fork `main` to upstream (if `main` is checked out in another worktree, push without checking it out):
   ```bash
   git push origin upstream/main:main --force-with-lease
   # or:
   # git checkout main && git reset --hard upstream/main && git push origin main --force-with-lease
   ```
3. Rebuild `personal` from upstream + the single SYNC.md commit:
   ```bash
   git checkout personal
   git reset --hard upstream/main
   git cherry-pick personal-sync
   ```
4. If you must edit this file, do it **now**, before merging PRs, and amend the cherry-picked commit.
   Whether the file changed or not, refresh `personal-sync` so its parent is the `upstream/main`
   fetched for this run:

   ```bash
   # Only when SYNC.md changed:
   git add SYNC.md
   git commit --amend --no-edit

   # Always:
   git tag -f personal-sync HEAD
   git push origin refs/tags/personal-sync --force
   ```

   Never add extra `SYNC.md` commits on top of merges.

5. Merge the single fork-only customization branch that enables the capabilities provisioned for
   Jake's paid Apple Developer team:
   ```bash
   git fetch origin \
     '+refs/heads/personal-ios-capabilities:refs/remotes/origin/personal-ios-capabilities'
   git merge --no-edit origin/personal-ios-capabilities
   ```
   This named customization branch is intentionally static. Do not add other fork-only
   customization branches here.
6. Query all open PRs authored by the authenticated GitHub user against upstream `main` exactly
   once for this run, then append the retained source branches for closed PRs #3982, #4058, #4515,
   and #4521. Closed GitHub PR head refs are immutable, so the retained entries intentionally track
   their live source branches instead. Preserve this combined ordered snapshot while resolving
   conflicts; do not re-query or re-resolve source branches partway through the rebuild. Sorting by
   PR number keeps the merge order stable (oldest first):

   ```bash
   mkdir -p .t3
   PR_SNAPSHOT="$PWD/.t3/personal-sync-prs.txt"
   PR_SNAPSHOT_RAW="$PWD/.t3/personal-sync-prs.raw.txt"
   gh pr list \
     --repo pingdotgg/t3code \
     --author @me \
     --base main \
     --state open \
     --limit 100 \
     --json number,headRefOid \
     --jq '.[] | [.number, "upstream", ("refs/pull/" + (.number | tostring) + "/head"), .headRefOid] | @tsv' \
     > "$PR_SNAPSHOT_RAW"

   while IFS=$'\t' read -r pr remote branch; do
     source_ref="refs/heads/$branch"
     expected_sha=$(git ls-remote "$remote" "$source_ref" | awk 'NR == 1 { print $1 }')
     test -n "$expected_sha" || {
       echo "Retained PR #$pr source $remote/$branch is missing." >&2
       exit 1
     }
     printf '%s\t%s\t%s\t%s\n' "$pr" "$remote" "$source_ref" "$expected_sha" \
       >> "$PR_SNAPSHOT_RAW"
   done < <(printf '%s\n' \
     $'3982\torigin\tt3code/share-grok-skill-discovery' \
     $'4058\thttps://github.com/A1-Events/t3code.git\tfeat/file-attachments' \
     $'4515\torigin\tfeat/chat-pseudo-project' \
     $'4521\torigin\tt3code/group-sidebar-threads-by-worktree')

   sort -n -k1,1 "$PR_SNAPSHOT_RAW" | awk -F '\t' '!seen[$1]++' | tee "$PR_SNAPSHOT"

   (
     set -e
     PR_SNAPSHOT="$PWD/.t3/personal-sync-prs.txt"
     test -s "$PR_SNAPSHOT"
     while IFS=$'\t' read -r pr remote source_ref expected_sha; do
       target_ref="refs/remotes/personal-sync/pr/$pr"
       git fetch "$remote" "+$source_ref:$target_ref"
       actual_sha=$(git rev-parse "$target_ref")
       if test "$actual_sha" != "$expected_sha"; then
         echo "PR #$pr moved from $expected_sha to $actual_sha; restart the rebuild." >&2
         exit 1
       fi
       if test "$pr" = 4521 && ! git merge-base --is-ancestor upstream/main "$target_ref"; then
         echo "Retained PR #4521 must be rebased onto the fetched upstream/main before syncing." >&2
         exit 1
       fi
       if git merge-base --is-ancestor "$target_ref" HEAD; then
         continue
       fi
       git merge --no-edit "$target_ref"
     done < "$PR_SNAPSHOT"
   )
   ```

   Resolve conflicts and continue through every PR/SHA pair in the printed snapshot. If the loop must
   be resumed, rerun only the parenthesized loop so it reads the same
   `.t3/personal-sync-prs.txt` and skips PR heads already contained in `HEAD`; do not run
   `gh pr list` or regenerate the retained-source rows again. If a head SHA changes, restart from
   step 1 and take a new snapshot rather than mixing states. Prefer fixing conflicts on the feature
   branch when practical. The four retained closed PR sources above are deliberate exceptions to
   the otherwise-authoritative one-time upstream PR query. Keep the #4521 source branch rebased on
   current `upstream/main`; do not work around a stale grouping branch on `personal`.

7. Cherry-pick the single fork-only post-merge reconciliation commit. This is the sole durable home
   for personal-only compatibility code and its tests, keeping cross-PR fixes reproducible without
   developing directly on `personal`:

   ```bash
   git fetch origin \
     '+refs/heads/personal-integration-fixes:refs/remotes/origin/personal-integration-fixes'
   git cherry-pick origin/personal-integration-fixes
   ```

   Do not treat an empty or conflicted cherry-pick as success until every personal invariant below
   is present and tested. In particular, the legacy remote-username bridge must remain until both
   upstream PR #8305 is merged **and** compatible managed `t3` server versions that advertise
   `RemoteOpenTarget.username` are deployed. Do not remove it merely because the PR merged; removal
   requires an explicit human decision that updates this file, the integration commit, and its
   dedicated test together.

   ```bash
   test -f apps/web/src/components/SidebarV2.logic.ts
   test -f apps/web/src/components/SidebarV2.logic.test.ts
   rg -q 'buildSidebarWorktreeGroups' apps/web/src/components/Sidebar.tsx
   test -f apps/web/src/remoteOpen.personal.test.ts
   rg -q 'TODO\(PERSONAL-BRANCH-REMOVE-AFTER-PR-8305\)' apps/web/src/remoteOpen.ts
   vp test run \
     apps/web/src/components/SidebarV2.logic.test.ts \
     apps/web/src/remoteOpen.personal.test.ts \
     apps/server/src/provider/Layers/GrokAdapter.test.ts \
     apps/server/src/vcs/GitVcsDriverCore.test.ts \
     apps/server/src/git/GitManager.test.ts
   vp run --filter @t3tools/web --filter t3 typecheck
   git diff --check upstream/main...HEAD
   ```

8. Push:
   ```bash
   git push origin personal --force-with-lease
   ```
9. Enable T3 Connect for source builds, then build the Mac desktop app (unsigned local DMG) for
   this machine’s arch. Personal artifacts intentionally use the public production T3 Connect client
   configuration. Since upstream #5573 those values ship in `.env.example`, so one repo-root `.env`
   feeds every build path instead of per-command env prefixes: `loadRepoEnv`
   (`scripts/lib/public-config.ts`) merges `.env` under the process env, and the desktop/web Vite
   configs, `scripts/build-desktop-artifact.ts`, and `apps/mobile/app.config.ts` all read through
   it. `.env` also carries `T3CODE_CLERK_CLI_OAUTH_CLIENT_ID`, which the old inline prefixes never
   set. These are public build-time identifiers, not server secrets; never add `CLERK_SECRET_KEY`
   here. `.env` is gitignored, so the clean-tree check at the end of this file still passes.

   Known upstream wrinkle: `.env` persists after this workflow and breaks two
   `apps/web/src/cloud/connectCliAuth.test.ts` cases, which assume no CLI OAuth client id is
   configured. `apps/web/vite.config.ts` bakes `VITE_CLERK_CLI_OAUTH_CLIENT_ID` at config time, so
   `vi.stubEnv` cannot unset it. Nothing here runs `npm test`, so the workflow is unaffected — but
   move `.env` aside when running the web suite until upstream fixes those tests.

   ```bash
   # Keep an already-customized .env; otherwise adopt upstream's production config.
   test -f .env || cp .env.example .env
   for key in T3CODE_CLERK_PUBLISHABLE_KEY T3CODE_CLERK_JWT_TEMPLATE T3CODE_RELAY_URL; do
     grep -qE "^${key}=." .env || {
       echo "$key is missing from .env; refresh it from .env.example." >&2
       exit 1
     }
   done
   ```

   Stamp the four release manifests with the newest upstream nightly tag reachable from
   `upstream/main`. Otherwise the app and its bundled server report the bare package version (for
   example `0.0.38`). The version-skew notice then cannot offer the matching nightly to an older
   remote server.

   The personal build must report a nightly version without using the official desktop update
   feed. An updater feed would let an official nightly replace the fork. Keep
   `T3CODE_DESKTOP_UPDATE_REPOSITORY` and `GITHUB_REPOSITORY` empty while packaging, then verify the
   app has no `Contents/Resources/app-update.yml`. The missing feed disables desktop update checks;
   it does not change the nightly version used to update remote T3 servers.

   Run the whole subshell below. Do not replace it with a direct
   `npm run dist:desktop:dmg:arm64`, which produces an unstamped build. The trap restores the four
   manifests afterward so the clean-tree check at the end still passes. Rebuild through this
   workflow when a newer upstream nightly appears.

   ```bash
   (
   set -eu
   NIGHTLY_VERSION=$(git describe --tags --match "v*-nightly.*" --abbrev=0 upstream/main)
   NIGHTLY_VERSION=${NIGHTLY_VERSION#v}
   RELEASE_MANIFESTS="apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json"
   trap "git checkout -- $RELEASE_MANIFESTS" EXIT
   export T3CODE_DESKTOP_UPDATE_REPOSITORY=
   export GITHUB_REPOSITORY=
   node scripts/update-release-package-versions.ts "$NIGHTLY_VERSION"
   # Apple Silicon
   npm run dist:desktop:dmg:arm64
   test -f "release/T3-Code-${NIGHTLY_VERSION}-arm64.dmg"
   # Intel
   # npm run dist:desktop:dmg:x64
   # test -f "release/T3-Code-${NIGHTLY_VERSION}-x64.dmg"
   )
   ```

   Then prune older packaged versions, replace the installed app, and verify that the personal
   Nightly opens a visible window. Quit both variants before replacing the bundle because Alpha and
   Nightly share `com.t3tools.t3code`:

   ```bash
   (
   set -eu

   NIGHTLY_VERSION=$(git describe --tags --match "v*-nightly.*" --abbrev=0 upstream/main)
   NIGHTLY_VERSION=${NIGHTLY_VERSION#v}
   DMG="release/T3-Code-${NIGHTLY_VERSION}-arm64.dmg"   # use -x64.dmg on Intel
   test -f "$DMG"
   CURRENT_PREFIX=$(basename "$DMG" .dmg)

   if find release -maxdepth 1 -type f -name 'T3-Code-*' \
     ! -name "$CURRENT_PREFIX*" -print -quit | grep -q .; then
     OLD_RELEASE_TRASH=$(mktemp -d \
       '/Users/jakeleventhal/.Trash/t3code-old-releases.XXXXXX')
     find release -maxdepth 1 -type f -name 'T3-Code-*' \
       ! -name "$CURRENT_PREFIX*" -exec mv {} "$OLD_RELEASE_TRASH/" \;
   fi

   osascript -e 'quit app "T3 Code (Alpha)"' 2>/dev/null || true
   osascript -e 'quit app "T3 Code (Nightly)"' 2>/dev/null || true
   for attempt in {1..20}; do
     ALPHA_RUNNING=$(osascript -e \
       'tell app "System Events" to return exists process "T3 Code (Alpha)"' \
       2>/dev/null || echo true)
     NIGHTLY_RUNNING=$(osascript -e \
       'tell app "System Events" to return exists process "T3 Code (Nightly)"' \
       2>/dev/null || echo true)
     if test "$ALPHA_RUNNING" = false && test "$NIGHTLY_RUNNING" = false; then
       break
     fi
     sleep 0.25
   done
   if test "$ALPHA_RUNNING" != false || test "$NIGHTLY_RUNNING" != false; then
     echo "Alpha or Nightly did not quit; refusing to replace a running app." >&2
     exit 1
   fi

   ATTACH_OUTPUT=$(diskutil image attach --mountOptions nobrowse "$DMG")
   VOL=$(printf '%s\n' "$ATTACH_OUTPUT" | \
     awk -F '\t' '$NF ~ /^\/Volumes\// { print $NF; exit }')
   INSTALL_STAGE=""
   cleanup_install() {
     diskutil eject "$VOL" >/dev/null 2>&1 || true
     if test -n "$INSTALL_STAGE" && test -d "$INSTALL_STAGE"; then
       FAILED_INSTALL_TRASH=$(mktemp -d \
         '/Users/jakeleventhal/.Trash/t3code-failed-install.XXXXXX')
       mv "$INSTALL_STAGE" "$FAILED_INSTALL_TRASH/"
     fi
   }
   trap cleanup_install EXIT
   test -d "$VOL/T3 Code (Nightly).app"
   test ! -f "$VOL/T3 Code (Nightly).app/Contents/Resources/app-update.yml"
   BUNDLED_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
     "$VOL/T3 Code (Nightly).app/Contents/Info.plist")
   if test "$BUNDLED_VERSION" != "$NIGHTLY_VERSION"; then
     echo "Expected nightly $NIGHTLY_VERSION, but the DMG contains $BUNDLED_VERSION." >&2
     exit 1
   fi

   INSTALL_STAGE=$(mktemp -d '/Applications/.t3code-nightly-install.XXXXXX')
   ditto "$VOL/T3 Code (Nightly).app" "$INSTALL_STAGE/T3 Code (Nightly).app"
   xattr -cr "$INSTALL_STAGE/T3 Code (Nightly).app"

   OLD_APP_TRASH=""
   if test -e "/Applications/T3 Code (Nightly).app"; then
     OLD_APP_TRASH=$(mktemp -d \
       '/Users/jakeleventhal/.Trash/t3code-old-nightly.XXXXXX')
     mv "/Applications/T3 Code (Nightly).app" "$OLD_APP_TRASH/"
   fi
   if ! mv "$INSTALL_STAGE/T3 Code (Nightly).app" /Applications/; then
     if test -n "$OLD_APP_TRASH"; then
       mv "$OLD_APP_TRASH/T3 Code (Nightly).app" /Applications/
     fi
     exit 1
   fi
   rmdir "$INSTALL_STAGE"
   INSTALL_STAGE=""
   cleanup_install
   trap - EXIT

   open -a "T3 Code (Nightly)"
   osascript -e 'tell app "T3 Code (Nightly)" to activate'
   for attempt in {1..40}; do
     WINDOW_COUNT=$(osascript -e \
       'tell app "System Events" to tell process "T3 Code (Nightly)" to count windows' \
       2>/dev/null || echo 0)
     test "$WINDOW_COUNT" -gt 0 && break
     sleep 0.25
   done
   test "${WINDOW_COUNT:-0}" -gt 0
   )
   ```

   Do **not** start `npm run dev` unless the user asks. In the final reply, include the DMG path and
   confirm the installed app was launched with a visible window. If macOS blocks the first launch,
   right-click the app and choose **Open**, then repeat the launch and window checks.

10. Build, install, and launch a self-contained Release app on Jake's physical iPhone. This path is
    device-only (`arm64`), does not build a simulator app, and does not need Metro after launch.

Persist these non-secret, machine-specific values in the worktree's ignored `.t3` state so each
new agent shell can reload them:

```bash
mkdir -p .t3
printf '%s\n' \
  'export IOS_BUNDLE_ID=com.jakeleventhal.t3code' \
  'export IOS_TEAM_ID=BNKA7GN2H2' \
  'export IOS_XCODE_DEVICE_ID=00008150-0011254C3C47801C' \
  'export IOS_CORE_DEVICE_ID=FD013F85-B776-57BD-BCD8-EAF72AEA30F0' \
  'export IOS_DERIVED_DATA="$PWD/release/ios-device/DerivedData"' \
  > "$PWD/.t3/personal-ios.env"
source "$PWD/.t3/personal-ios.env"
```

The iPhone must be connected, unlocked, trusted, and have Developer Mode enabled. Use the installed
Xcode beta and CocoaPods. Expo CLI may warn that Xcode 27's `devicectl` JSON v4 is unexpected, so
use the direct `xcodebuild` and `devicectl` commands below instead of relying on Expo's device
picker.

The `personal-ios-capabilities` branch makes the paid-team capabilities explicit opt-ins. The
App IDs `com.jakeleventhal.t3code` and `com.jakeleventhal.t3code.widgets`, App Group
`group.com.jakeleventhal.t3code`, Push Notifications capability, signing certificate, registered
device, and development provisioning profiles must remain available in Apple Developer account
team `BNKA7GN2H2`. The flags below enable notification and Live Activity support in the generated
app; do not remove them from any of the three commands. They stay inline because they are
fork-only and deliberately absent from upstream's `.env.example`.

The T3 Connect values come from the `.env` written in step 9 — `EXPO_NO_DOTENV=1` only disables
Expo's own dotenv loading, while `apps/mobile/app.config.ts` calls `loadRepoEnv()` directly and
still reads the repo-root `.env`. The `jq` assertion below pins that, so a missing or stale `.env`
fails here rather than silently shipping a build with cloud features disabled.

Verify the resolved config before generating the native project:

```bash
source "$PWD/.t3/personal-ios.env"
(
  cd apps/mobile
  T3CODE_IOS_PERSONAL_TEAM=1 \
  T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID="$IOS_BUNDLE_ID" \
  T3CODE_IOS_PERSONAL_TEAM_PUSH_NOTIFICATIONS=1 \
  T3CODE_IOS_PERSONAL_TEAM_LIVE_ACTIVITIES=1 \
  APP_VARIANT=production EXPO_NO_DOTENV=1 \
  ./node_modules/.bin/expo config --type public --json
) | \
  jq -e '
    .ios.bundleIdentifier == env.IOS_BUNDLE_ID and
    (.ios.appleTeamId == null) and
    ((.ios.associatedDomains // []) | length == 0) and
    (.extra.iosPersonalTeamBuild == true) and
    (.extra.iosPersonalTeamPushNotifications == true) and
    (.extra.iosPersonalTeamLiveActivities == true) and
    (.extra.relay.url == "https://relay.t3.codes") and
    (.extra.clerk.publishableKey == "pk_live_Y2xlcmsudDMuY29kZXMk") and
    (.extra.clerk.jwtTemplate == "t3-relay")
  '
```

Generate the native iOS project, then build only the connected device destination. Keep DerivedData
outside `apps/mobile/ios` so `expo prebuild --clean` does not discard the cold-build cache:

```bash
source "$PWD/.t3/personal-ios.env"
(
  cd apps/mobile
  T3CODE_IOS_PERSONAL_TEAM=1 \
  T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID="$IOS_BUNDLE_ID" \
  T3CODE_IOS_PERSONAL_TEAM_PUSH_NOTIFICATIONS=1 \
  T3CODE_IOS_PERSONAL_TEAM_LIVE_ACTIVITIES=1 \
  APP_VARIANT=production EXPO_NO_GIT_STATUS=1 EXPO_NO_DOTENV=1 \
  ./node_modules/.bin/expo prebuild --clean --platform ios
)

T3CODE_IOS_PERSONAL_TEAM=1 \
T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID="$IOS_BUNDLE_ID" \
T3CODE_IOS_PERSONAL_TEAM_PUSH_NOTIFICATIONS=1 \
T3CODE_IOS_PERSONAL_TEAM_LIVE_ACTIVITIES=1 \
APP_VARIANT=production EXPO_NO_DOTENV=1 \
xcodebuild -quiet \
  -workspace apps/mobile/ios/T3Code.xcworkspace \
  -scheme T3Code \
  -configuration Release \
  -destination "platform=iOS,id=$IOS_XCODE_DEVICE_ID" \
  -derivedDataPath "$IOS_DERIVED_DATA" \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$IOS_TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  IPHONEOS_DEPLOYMENT_TARGET=18.0 \
  build
```

Verify the device artifact, install it, and launch it:

```bash
source "$PWD/.t3/personal-ios.env"
IOS_APP="$IOS_DERIVED_DATA/Build/Products/Release-iphoneos/T3Code.app"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$IOS_APP/Info.plist")" = "$IOS_BUNDLE_ID"
file "$IOS_APP/T3Code" | grep -q 'arm64'
codesign --verify --deep --strict --verbose=2 "$IOS_APP"
xcrun devicectl device install app --device "$IOS_CORE_DEVICE_ID" "$IOS_APP"
xcrun devicectl device process launch \
  --device "$IOS_CORE_DEVICE_ID" \
  --terminate-existing \
  "$IOS_BUNDLE_ID"
xcrun devicectl device info processes --device "$IOS_CORE_DEVICE_ID" | grep -q '/T3Code.app/T3Code'
```

If launch reports that the device is locked, unlock it and rerun only the launch and process checks.
If iOS reports an untrusted developer, trust Jake's developer profile under **Settings → General →
VPN & Device Management**, then launch again.

Confirm the workflow did not leave tracked changes:

```bash
test -z "$(git status --porcelain)"
```

In the final reply, include the `.app` path and confirm installation and launch on Jake's iPhone.

Do not develop features on `personal`. Do not force-push unrelated branches.

## Remotes

```bash
# one-time, if missing
git remote add upstream git@github.com:pingdotgg/t3code.git
git fetch upstream
```

| Branch / ref                 | Role                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `main`                       | Tracks `upstream/main` only                                  |
| `t3code/...`                 | Individual PRs into upstream                                 |
| `personal`                   | Runnable build = upstream + sync + customization + PR merges |
| `personal-ios-capabilities`  | Fork-only paid Apple Developer capability customization      |
| `personal-integration-fixes` | Fork-only post-merge compatibility code and focused tests    |
| `personal-sync`              | Tag = **exactly one** commit (upstream + `SYNC.md` only)     |

## Recreate the SYNC.md commit (rare)

If `personal-sync` is missing or polluted with merge history:

```bash
git fetch upstream
git fetch origin \
  '+refs/heads/personal:refs/remotes/origin/personal'
git checkout --detach upstream/main
git restore --source=origin/personal -- SYNC.md
git add SYNC.md
git commit -m "SYNC.md"
git tag -f personal-sync HEAD
git push origin refs/tags/personal-sync --force
git checkout personal
```

## Notes

- Prefer **merge** over rebase on `personal` — easier conflict resolution when PR branches diverge.
- If two PRs conflict with each other, fix on the feature branch (or temporarily on `personal`), never on `main`.
- Never leave a persistent fix only on `personal`; fold it into one of the named fork branches before the next reset.
- Alpha and Nightly share `com.t3tools.t3code`; only one can run at a time.
