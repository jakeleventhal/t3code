# Physical iPhone build and installation

Build from the same integrated Git SHA as the desktop. Use the V2 mobile source;
do not reuse a V1 app. The iOS marketing version is independently set in
`app.config.ts`; record the integrated SHA and preview version in the run receipt
instead of assuming the iOS version equals the server version. Build now and defer
the install/launch block until the matching V2 servers are active.

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

The T3 Connect values come from the repo-root `.env` prepared in desktop.md.
`EXPO_NO_DOTENV=1` only disables
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

If the phone is locked before installation, build with `-destination generic/platform=iOS` and resume only installation/launch after unlock. If installation succeeded but launch reports that the device is locked, rerun only the launch and process checks.
If iOS reports an untrusted developer, trust Jake's developer profile under **Settings > General >
VPN & Device Management**, then launch again.

Confirm the workflow did not leave tracked changes:

```bash
test -z "$(git status --porcelain)"
```

In the final reply, include the `.app` path and confirm installation and launch on Jake's iPhone.
