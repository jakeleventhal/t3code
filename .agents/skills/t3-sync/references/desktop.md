# Custom preview desktop

## Build before activation

Reload `SYNC_RUN` and `RELEASE_VERSION` from this run's snapshot. Confirm `HEAD`
matches `integrated.sha`. Use the repo-root `.env` with the public production T3
Connect values. Keep an existing customized `.env`; otherwise copy `.env.example`.
Require nonempty `T3CODE_CLERK_PUBLISHABLE_KEY`, `T3CODE_CLERK_JWT_TEMPLATE`, and
`T3CODE_RELAY_URL`. Preserve `T3CODE_CLERK_CLI_OAUTH_CLIENT_ID` and any reusable dev
auth token without printing them. Never add `CLERK_SECRET_KEY` or localhost origins.

```bash
(
set -eu
RELEASE_VERSION=$(jq -r .version "$SYNC_RUN/release.json")
RELEASE_MANIFESTS="apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json"
# These manifests must be clean before stamping; otherwise preserve changes first.
for manifest in $RELEASE_MANIFESTS; do
  git diff --quiet HEAD -- "$manifest" || exit 1
done
trap 'git restore --worktree -- apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json' EXIT
export T3CODE_DESKTOP_UPDATE_REPOSITORY=
export GITHUB_REPOSITORY=
node scripts/update-release-package-versions.ts "$RELEASE_VERSION"
npm run dist:desktop:dmg:arm64
# Intel: use dist:desktop:dmg:x64 and the corresponding filename.
test -f "release/T3-Code-${RELEASE_VERSION}-arm64.dmg"
)
```

The preview build must have no `Contents/Resources/app-update.yml`. Official
updates would discard the personal changes. Inspect the selected source's
`resolveDesktopProductName` if packaging changes; preview uses the `productName` in
`apps/desktop/package.json`, currently `T3 Code (Alpha)`. Do not label the build Nightly to get a remote update notification.
The runtime bundled inside the DMG must report the selected preview version too.
Use the packaged server's actual entrypoint/layout when checking `--version`.

## Install after both builds and remote preparation

Run activation from an independent shell if quitting T3 would terminate the
coordinator. Preserve a durable log and the exact artifact paths. The desktop
must retain the existing T3 home and V2 history.
Do not launch a development server against that home.

Then prune older packaged versions, replace the installed app, and verify that the personal
preview opens a visible window. Quit all installed variants before replacing the bundle because Alpha,
Nightly, and Preview share `com.t3tools.t3code`:

```bash
(
set -eu

RELEASE_VERSION=$(jq -r .version "$SYNC_RUN/release.json")
DMG="release/T3-Code-${RELEASE_VERSION}-arm64.dmg"   # use -x64.dmg on Intel
test -f "$DMG"
CURRENT_PREFIX=$(basename "$DMG" .dmg)
DESKTOP_APP_NAME=$(node -p 'JSON.parse(require("fs").readFileSync("apps/desktop/package.json", "utf8")).productName || "T3 Code"')

if find release -maxdepth 1 -type f -name 'T3-Code-*' \
  ! -name "$CURRENT_PREFIX*" -print -quit | grep -q .; then
  OLD_RELEASE_TRASH=$(mktemp -d \
    '/Users/jakeleventhal/.Trash/t3code-old-releases.XXXXXX')
  find release -maxdepth 1 -type f -name 'T3-Code-*' \
    ! -name "$CURRENT_PREFIX*" -exec mv {} "$OLD_RELEASE_TRASH/" \;
fi

osascript -e 'quit app "T3 Code"' 2>/dev/null || true
osascript -e 'quit app "T3 Code (Alpha)"' 2>/dev/null || true
osascript -e 'quit app "T3 Code (Nightly)"' 2>/dev/null || true
for attempt in {1..20}; do
  ALPHA_RUNNING=$(osascript -e \
    'tell app "System Events" to return exists process "T3 Code (Alpha)"' \
    2>/dev/null || echo true)
  NIGHTLY_RUNNING=$(osascript -e \
    'tell app "System Events" to return exists process "T3 Code (Nightly)"' \
    2>/dev/null || echo true)
  PREVIEW_RUNNING=$(osascript -e \
    'tell app "System Events" to return exists process "T3 Code"' \
    2>/dev/null || echo true)
  if test "$PREVIEW_RUNNING" = false && test "$ALPHA_RUNNING" = false && test "$NIGHTLY_RUNNING" = false; then
    break
  fi
  sleep 0.25
done
if test "$PREVIEW_RUNNING" != false || test "$ALPHA_RUNNING" != false || test "$NIGHTLY_RUNNING" != false; then
  echo "An affected T3 app did not quit; refusing to replace a running app." >&2
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
test -d "$VOL/$DESKTOP_APP_NAME.app"
test ! -f "$VOL/$DESKTOP_APP_NAME.app/Contents/Resources/app-update.yml"
BUNDLED_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  "$VOL/$DESKTOP_APP_NAME.app/Contents/Info.plist")
if test "$BUNDLED_VERSION" != "$RELEASE_VERSION"; then
  echo "Expected preview $RELEASE_VERSION, but the DMG contains $BUNDLED_VERSION." >&2
  exit 1
fi

INSTALL_STAGE=$(mktemp -d '/Applications/.t3code-preview-install.XXXXXX')
ditto "$VOL/$DESKTOP_APP_NAME.app" "$INSTALL_STAGE/$DESKTOP_APP_NAME.app"
xattr -cr "$INSTALL_STAGE/$DESKTOP_APP_NAME.app"

OLD_APP_TRASH=""
if test -e "/Applications/$DESKTOP_APP_NAME.app"; then
  OLD_APP_TRASH=$(mktemp -d \
    '/Users/jakeleventhal/.Trash/t3code-old-preview.XXXXXX')
  mv "/Applications/$DESKTOP_APP_NAME.app" "$OLD_APP_TRASH/"
fi
if ! mv "$INSTALL_STAGE/$DESKTOP_APP_NAME.app" /Applications/; then
  if test -n "$OLD_APP_TRASH"; then
    mv "$OLD_APP_TRASH/$DESKTOP_APP_NAME.app" /Applications/
  fi
  exit 1
fi
rmdir "$INSTALL_STAGE"
INSTALL_STAGE=""
cleanup_install
trap - EXIT

open "/Applications/$DESKTOP_APP_NAME.app"
osascript -e "tell app \"/Applications/$DESKTOP_APP_NAME.app\" to activate"
for attempt in {1..40}; do
  WINDOW_COUNT=$(osascript -e \
    "tell app \"System Events\" to tell process \"$DESKTOP_APP_NAME\" to count windows" \
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

Keep a zero window count as an explicit verification gap if macOS Automation permissions prevent the check. Do not claim a visible window from process existence alone.
