# Personal fork sync

**Agent trigger:** if the user says to follow this file and rebuild (e.g. “follow SYNC.md and rebuild the app”), execute **Agent checklist** end-to-end without asking for confirmation on the listed git force-with-lease pushes.

Keep `main` as a clean mirror of upstream. Run from `personal`, which stacks every open PR authored by the authenticated GitHub user against `pingdotgg/t3code` on top of upstream.

`SYNC.md` lives only on `personal`. The `personal-sync` tag must always point at **one** commit whose sole change is this file on top of `upstream/main` (never a merge tip). Rebuilds cherry-pick that commit.

## Agent checklist

Do these in order:

1. Ensure remotes exist (`origin` = fork, `upstream` = `pingdotgg/t3code`). Fetch both.
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
4. If you must edit this file, do it **now**, before merging PRs, and keep it as that same single commit:
   ```bash
   # edit SYNC.md, then:
   git add SYNC.md
   git commit --amend --no-edit
   git tag -f personal-sync HEAD
   git push origin personal-sync --force
   ```
   Never add extra `SYNC.md` commits on top of merges.
5. Query all open PRs authored by the authenticated GitHub user against upstream `main`, then fetch and merge each PR head. Sorting by PR number keeps the merge order stable (oldest first):
   ```bash
   for pr in $(gh pr list \
     --repo pingdotgg/t3code \
     --author @me \
     --base main \
     --state open \
     --limit 100 \
     --json number \
     --jq 'sort_by(.number)[] | .number'); do
     git fetch upstream "+pull/$pr/head:refs/remotes/upstream/pr/$pr"
     git merge --no-edit "upstream/pr/$pr"
   done
   ```
   Resolve conflicts and continue through every PR. Prefer fixing conflicts on the feature branch when practical. Do not maintain a static branch list in this file; the upstream PR query is authoritative for each rebuild.
6. Push:
   ```bash
   git push origin personal --force-with-lease
   ```
7. Build the Mac desktop app (unsigned local DMG) for this machine’s arch:
   ```bash
   # Apple Silicon
   npm run dist:desktop:dmg:arm64
   # Intel
   # npm run dist:desktop:dmg:x64
   ```
   Then install and launch:
   ```bash
   DMG=$(ls -t release/T3-Code-*-arm64.dmg | head -1)   # or *-x64.dmg on Intel
   hdiutil attach "$DMG" -nobrowse
   VOL=$(ls -d /Volumes/T3\ Code* | head -1)
   rm -rf "/Applications/T3 Code (Alpha).app"
   cp -R "$VOL/T3 Code (Alpha).app" /Applications/
   xattr -cr "/Applications/T3 Code (Alpha).app"
   hdiutil detach "$VOL"
   # Quit Nightly first if running — Alpha and Nightly share com.t3tools.t3code
   osascript -e 'quit app "T3 Code (Nightly)"' 2>/dev/null || true
   pkill -f "T3 Code \\(Nightly\\)" 2>/dev/null || true
   sleep 1
   open -a "T3 Code (Alpha)"
   ```
   Do **not** start `npm run dev` unless the user asks. In the final reply, include the DMG path and confirm the app was launched. First Gatekeeper prompt: right-click → **Open**.
8. Build, install, and launch a self-contained Release app on Jake's physical iPhone. This path is
   device-only (`arm64`), does not build a simulator app, and does not need Metro after launch.

   Use these machine-specific values:

   ```bash
   export IOS_BUNDLE_ID=com.jakeleventhal.t3code
   export IOS_TEAM_ID=BNKA7GN2H2
   export IOS_XCODE_DEVICE_ID=00008150-0011254C3C47801C
   export IOS_CORE_DEVICE_ID=FD013F85-B776-57BD-BCD8-EAF72AEA30F0
   export IOS_DERIVED_DATA="$PWD/release/ios-device/DerivedData"
   ```

   The iPhone must be connected, unlocked, trusted, and have Developer Mode enabled. Use the installed
   Xcode beta and CocoaPods; do not use Expo's device picker with Xcode 27 because its `devicectl` JSON
   parser does not recognize Xcode 27's output yet.

   Current upstream has a Personal Team config regression. Until upstream resolves it, temporarily edit
   `apps/mobile/app.config.ts` in the working tree so the Personal Team bundle ID is used consistently
   and capabilities that require the T3 Tools team are omitted:

   ```diff
    const variant = VARIANT_CONFIG[APP_VARIANT];
   +const iosBundleIdentifier =
   +  isIosPersonalTeamBuild && personalTeamBundleIdentifier
   +    ? personalTeamBundleIdentifier
   +    : variant.iosBundleIdentifier;

   -    bundleIdentifier: `${variant.iosBundleIdentifier}.widgets`,
   -    groupIdentifier: `group.${variant.iosBundleIdentifier}`,
   +    bundleIdentifier: `${iosBundleIdentifier}.widgets`,
   +    groupIdentifier: `group.${iosBundleIdentifier}`,

   -    bundleIdentifier: variant.iosBundleIdentifier,
   +    bundleIdentifier: iosBundleIdentifier,
   -    appleTeamId: "ARK85ZXQ4Z",
   -    associatedDomains: [
   -      `applinks:${variant.relyingParty}`,
   -      `webcredentials:${variant.relyingParty}`,
   -    ],
   +    appleTeamId: isIosPersonalTeamBuild ? undefined : "ARK85ZXQ4Z",
   +    associatedDomains: isIosPersonalTeamBuild
   +      ? undefined
   +      : [`applinks:${variant.relyingParty}`, `webcredentials:${variant.relyingParty}`],
   ```

   Verify the resolved config before generating the native project:

   ```bash
   T3CODE_IOS_PERSONAL_TEAM=1 \
   T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID="$IOS_BUNDLE_ID" \
   APP_VARIANT=production EXPO_NO_DOTENV=1 \
   pnpm --filter @t3tools/mobile exec expo config --type public --json | \
     jq -e '
       .ios.bundleIdentifier == env.IOS_BUNDLE_ID and
       (.ios.appleTeamId == null) and
       ((.ios.associatedDomains // []) | length == 0)
     '
   ```

   Xcode 27 cannot compile the Clerk iOS SDK 1.2.9 pinned by `@clerk/expo` 3.7.2. Patch only the
   installed podspec to require Clerk iOS 1.3.1; this is a no-op after `@clerk/expo` is upgraded:

   ```bash
   CLERK_PODSPEC=$(cd apps/mobile && node -p \
     "require('node:path').join(require('node:path').dirname(require.resolve('@clerk/expo/package.json')), 'ios/ClerkExpo.podspec')")
   ruby -e '
     path = ARGV.fetch(0)
     source = File.read(path)
     source = source.sub("clerk_ios_version = '\''1.2.9'\''", "clerk_ios_version = '\''1.3.1'\''")
     abort "Clerk iOS 1.3.1 was not selected in #{path}" unless source.include?("clerk_ios_version = '\''1.3.1'\''")
     File.write(path, source)
   ' "$CLERK_PODSPEC"
   ```

   Generate the native iOS project, then build only the connected device destination. Keep DerivedData
   outside `apps/mobile/ios` so `expo prebuild --clean` does not discard the cold-build cache:

   ```bash
   T3CODE_IOS_PERSONAL_TEAM=1 \
   T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID="$IOS_BUNDLE_ID" \
   APP_VARIANT=production EXPO_NO_GIT_STATUS=1 EXPO_NO_DOTENV=1 \
   pnpm --filter @t3tools/mobile exec expo prebuild --clean --platform ios

   T3CODE_IOS_PERSONAL_TEAM=1 \
   T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID="$IOS_BUNDLE_ID" \
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

   Restore the temporary tracked config edit after the install so `personal` remains clean:

   ```bash
   git restore apps/mobile/app.config.ts
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

| Branch / ref    | Role                                                         |
| --------------- | ------------------------------------------------------------ |
| `main`          | Tracks `upstream/main` only                                  |
| `t3code/...`    | Individual PRs into upstream                                 |
| `personal`      | Runnable build = upstream + one `SYNC.md` commit + PR merges |
| `personal-sync` | Tag = **exactly one** commit (upstream + `SYNC.md` only)     |

## Recreate the SYNC.md commit (rare)

If `personal-sync` is missing or polluted with merge history:

```bash
git fetch upstream
git checkout --detach upstream/main
# ensure SYNC.md is the desired contents, then:
git add SYNC.md
git commit -m "SYNC.md"
git tag -f personal-sync HEAD
git push origin personal-sync --force
git checkout personal
```

## Notes

- Prefer **merge** over rebase on `personal` — easier conflict resolution when PR branches diverge.
- If two PRs conflict with each other, fix on the feature branch (or temporarily on `personal`), never on `main`.
- Alpha and Nightly share `com.t3tools.t3code`; only one can run at a time.
