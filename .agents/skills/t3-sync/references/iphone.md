# Physical iPhone build and installation

Build from the same integrated Git SHA as the desktop. The iOS marketing version
is independently set in `app.config.ts`; record the integrated SHA and Nightly
version in the run receipt
instead of assuming the iOS version equals the server version. Build now and defer
the install/launch block until the matching integrated servers are active.

Persist these non-secret, machine-specific values in the worktree's ignored `.t3` state so each
new agent shell can reload them:

```bash
set -eu
mkdir -p .t3
printf '%s\n' \
  'export IOS_BUNDLE_ID=com.jakeleventhal.t3code' \
  'export IOS_TEAM_ID=BNKA7GN2H2' \
  'export IOS_XCODE_DEVICE_ID=00008150-0011254C3C47801C' \
  'export IOS_DERIVED_DATA="$PWD/release/ios-device/DerivedData"' \
  > "$PWD/.t3/personal-ios.env"
source "$PWD/.t3/personal-ios.env"
```

The iPhone must be connected, unlocked, trusted, and have Developer Mode enabled.
Use the selected full Xcode installation and CocoaPods. Jakebook's validated
toolchain is `/Applications/Xcode.app`, Xcode 27.1; check `xcode-select -p` and
`xcodebuild -version` rather than looking for Xcode beta. Keep Jake's existing
Xcode Apple account signed in with team `BNKA7GN2H2`. Use the physical UDID above
for both xcodebuild and devicectl; the CoreDevice UUID can change between pairings.
Expo CLI may warn that Xcode 27's `devicectl` JSON v4 is unexpected, so
use the direct `xcodebuild` and `devicectl` commands below instead of relying on Expo's device
picker.

The `personal-ios-capabilities` branch makes the paid-team capabilities explicit opt-ins. The
App IDs `com.jakeleventhal.t3code` and `com.jakeleventhal.t3code.widgets`, App Group
`group.com.jakeleventhal.t3code`, Push Notifications capability, signing certificate, registered
device, and development provisioning profiles must remain available in Apple Developer account
team `BNKA7GN2H2`. Both App IDs need Push Notifications, including the widget
extension: a valid main-app profile does not cover its separate widget profile.
These capabilities and the Xcode account are already configured; reuse automatic
signing instead of creating new identities or disabling capabilities to get a build.

Personal-team Release builds use **development APNs in both the app and widget**.
Preserve the widget adaptation in `withAgentWidgetRefresh.cjs` as well as the main
app configuration. It derives the widget entitlement from the existing
`T3CODE_IOS_PERSONAL_TEAM=1` flag; there is no separate widget flag. A production
APNs widget entitlement cannot use Jake's development provisioning profile.

The flags below enable notification and Live Activity support in the generated
app; do not remove them from any of the three commands. They stay inline because they are
fork-only and deliberately absent from upstream's `.env.example`.

The T3 Connect values come from the repo-root `.env` prepared in desktop.md.
`EXPO_NO_DOTENV=1` only disables
Expo's own dotenv loading, while `apps/mobile/app.config.ts` calls `loadRepoEnv()` directly and
still reads the repo-root `.env`. The `jq` assertion below pins that, so a missing or stale `.env`
fails here rather than silently shipping a build with cloud features disabled.

Verify the frozen source and resolved config before generating the native project:

```bash
set -eu
source "$PWD/.t3/personal-ios.env"
SYNC_RUN=$(cat "$PWD/.t3/personal-sync/current-run")
test "$(git rev-parse HEAD)" = "$(cat "$SYNC_RUN/integrated.sha")"
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
    (any(.extra.eas.build.experimental.ios.appExtensions[];
      .targetName == "ExpoWidgetsTarget" and
      .bundleIdentifier == (env.IOS_BUNDLE_ID + ".widgets") and
      .entitlements["aps-environment"] == "development")) and
    (.extra.relay.url == "https://relay.t3.codes") and
    (.extra.clerk.publishableKey == "pk_live_Y2xlcmsudDMuY29kZXMk") and
    (.extra.clerk.jwtTemplate == "t3-relay")
  '
```

Generate the native iOS project, then build only the connected device destination. Keep DerivedData
outside `apps/mobile/ios` so `expo prebuild --clean` does not discard the cold-build cache:

```bash
set -eu
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

# Verify regenerated native entitlements before the expensive native build.
python3 - <<'PY'
import plistlib
from pathlib import Path
root = Path("apps/mobile/ios")
for relative in ["T3Code/T3Code.entitlements", "ExpoWidgetsTarget/ExpoWidgetsTarget.entitlements"]:
    with (root / relative).open("rb") as source:
        entitlements = plistlib.load(source)
    assert entitlements["aps-environment"] == "development", relative
    assert "group.com.jakeleventhal.t3code" in entitlements["com.apple.security.application-groups"], relative
PY

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
set -eu
source "$PWD/.t3/personal-ios.env"
SYNC_RUN=$(cat "$PWD/.t3/personal-sync/current-run")
IOS_APP="$IOS_DERIVED_DATA/Build/Products/Release-iphoneos/T3Code.app"
python3 .agents/skills/t3-sync/scripts/verify-iphone.py \
  --app "$IOS_APP" --bundle-id "$IOS_BUNDLE_ID" --team-id "$IOS_TEAM_ID" \
  --device-id "$IOS_XCODE_DEVICE_ID" \
  --source-sha "$(cat "$SYNC_RUN/integrated.sha")" \
  --nightly-version "$(jq -r .version "$SYNC_RUN/release.json")" \
  --output "$SYNC_RUN/iphone-signed-verification.json"
printf '%s\n' "$IOS_APP" > "$SYNC_RUN/iphone-artifact.txt"
xcrun devicectl device install app --device "$IOS_XCODE_DEVICE_ID" "$IOS_APP"
printf '%s\n' installed > "$SYNC_RUN/iphone-installed"
xcrun devicectl device process launch \
  --device "$IOS_XCODE_DEVICE_ID" \
  --terminate-existing \
  "$IOS_BUNDLE_ID"
xcrun devicectl device info processes --device "$IOS_XCODE_DEVICE_ID" | grep -q '/T3Code.app/T3Code'
printf '%s\n' verified > "$SYNC_RUN/iphone-launch.verified"
```

If the phone is locked before installation, build with `-destination generic/platform=iOS` and resume only installation/launch after unlock. If installation succeeded but launch reports that the device is locked, rerun only the launch and process checks.
Generic-device Release builds were validated on Jakebook and can be used to
prepare the signed artifact before the phone is available. Keep
`IPHONEOS_DEPLOYMENT_TARGET=18.0`, `CODE_SIGN_STYLE=Automatic`, the team, and both
provisioning flags. A locked phone is not a reason to build unsigned.

If signing fails, distinguish the failure before retrying: `No Accounts` means
Xcode's Apple account needs attention; a widget profile missing Push Notifications
means its App ID/profile needs attention. Retain the generated project and
DerivedData; after repairing signing, rerun xcodebuild and the artifact verifier,
not source selection or Expo prebuild. Never record an unsigned compile as a
completed iPhone artifact. The verifier checks embedded JavaScript, both signed
entitlements, each profile's team/device/App Group/APNs, and expiration without
printing credentials or full profiles.
If iOS reports an untrusted developer, trust Jake's developer profile under **Settings > General >
VPN & Device Management**, then launch again.

Confirm the workflow did not leave tracked changes:

```bash
set -eu
test -z "$(git status --porcelain)"
```

In the final reply, include the `.app` path and confirm installation and launch on Jake's iPhone.
