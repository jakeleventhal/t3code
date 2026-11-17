# Rebuild and deploy the remote servers

Two remote servers run the personal build. Rebuild and redeploy both every run,
from the same integrated.sha and frozen Nightly version:

| Target | SSH alias | Platform     | Builder                  | Service                                  |
| ------ | --------- | ------------ | ------------------------ | ---------------------------------------- |
| R2-D2  | `r2d2`    | darwin-arm64 | Jakebook                 | LaunchAgent `com.t3tools.t3code.service` |
| C-3PO  | `c3po`    | linux-x64    | C-3PO, isolated checkout | systemd user unit `t3code.service`       |

Each target is independent: a blocked target does not block the other one or
the desktop and iPhone builds. Keep a separate archive, checksum, activation log
and receipt per target in SYNC_RUN.

Use each existing environment over its configured SSH/Tailscale route.
Confirm the host, installation owner, CLI path, service, actual T3 home, and
CPU/OS from configuration before changing anything. Test an actual SSH command;
Tailscale Online alone does not establish access. Record non-secret target
details in SYNC_RUN, preserving identity, credentials, home, and connection
configuration. Never enroll unrelated hosts or start a second server on its home.

If access is blocked, continue independent builds and report deployment as
incomplete. Resume only the blocked build/deployment/verification step after
reconnection; do not reset source or select a new Nightly.

## Build from the integrated source

Always rebuild each remote server from this run's integrated.sha, with the frozen
Nightly version. A published upstream runtime omits Jake's server changes.
Use an isolated checkout on the target or a matching OS/CPU builder. Transfer the exact
source commit, lockfile, and necessary public T3 Connect configuration privately.
Do not build against the live T3 home.

Follow that source's normal standalone release pipeline. Inspect
scripts/build-cli-archive.ts and .github/workflows/release.yml for build
prerequisites and the current CLI archive steps: server executable, bundled web
client, resource monitor, and native runtime dependencies. Stamp the frozen
Nightly version and restore tracked release manifests afterward. Record the
archive path, checksum, platform/architecture, version, and integrated Git SHA.
The runtime and bundled web client must come from that same source.

### R2-D2 (darwin-arm64)

For the existing Darwin arm64 R2-D2, Jakebook is a matching builder. This
sequence produced the validated custom archive; the detailed upstream recipe
lives in `.github/workflows/release-desktop.yml`. The single-executable step
requires the exact Node version in the root `package.json` `engines.node`
field. `apps/server/vite.config.ts` checks the running Node process against it.
Put that actual Node binary directory on PATH and assert its version before building.

```bash
(
set -eu
RELEASE_VERSION=$(jq -r .version "$SYNC_RUN/release.json")
BUILD_NODE_VERSION=$(node -p "require('./package.json').engines.node")
test "$(node --version)" = "v$BUILD_NODE_VERSION"
test "$(git rev-parse HEAD)" = "$(cat "$SYNC_RUN/integrated.sha")"
for manifest in apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json; do
  git diff --quiet HEAD -- "$manifest"
done
trap 'git restore --worktree -- apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json' EXIT
node scripts/update-release-package-versions.ts "$RELEASE_VERSION"
vp run --filter @t3tools/web build
vp run --filter t3 build
VP_NODE_VERSION="$BUILD_NODE_VERSION" node apps/server/scripts/cli.ts build-exe --verbose
cargo build --locked --release --target aarch64-apple-darwin \
  --manifest-path native/resource-monitor/Cargo.toml
mkdir -p "$SYNC_RUN/remote-resource-monitor/darwin-arm64"
cp native/resource-monitor/target/aarch64-apple-darwin/release/t3-resource-monitor \
  "$SYNC_RUN/remote-resource-monitor/darwin-arm64/t3-resource-monitor"
node scripts/build-cli-archive.ts --platform mac --arch arm64 \
  --version "$RELEASE_VERSION" \
  --resource-monitor-dir "$SYNC_RUN/remote-resource-monitor" \
  --output-dir "$SYNC_RUN/remote-archive"
node scripts/smoke-cli-archive.ts \
  --archive "$SYNC_RUN/remote-archive/t3-${RELEASE_VERSION}-darwin-arm64.tar.gz" \
  --expect-version "$RELEASE_VERSION"
shasum -a 256 "$SYNC_RUN/remote-archive/t3-${RELEASE_VERSION}-darwin-arm64.tar.gz"
)
```

Put the required Node binary directory on PATH before invoking `node`;
`VP_NODE_VERSION` alone does not replace the Node process running this script.
Assert `node --version` first. Include `~/.cargo/bin` on PATH when Cargo is there.
Reuse a verified cached Node distribution or obtain the matching official one.

Run builds that stamp the same checkout's manifests sequentially. Use isolated
checkouts if building targets concurrently, so one build's cleanup cannot erase
another build's version stamp.

### C-3PO (linux-x64)

Build on C-3PO itself, in the isolated checkout `~/.cache/t3-sync-build/t3code`
(a clone of the fork; never `~/.t3`). Fetch `personal` and detach at
integrated.sha. Copy Jakebook's root `.env`, which holds the public T3 Connect
build config (`T3CODE_CLERK_*`, `T3CODE_RELAY_URL`), over scp with mode 600;
never print its values. Stage the run's `release.json`, `integrated.sha` and
`nightly-version.txt` in `~/.t3/personal-sync/<run>/` on C-3PO and keep that
run's logs there.

User-level toolchain, no sudo (sudo on C-3PO needs a password):

- Node: the exact `engines.node` from the official linux-x64 tarball, checked
  against `SHASUMS256.txt`, in `~/.cache/t3-sync-node/node-v<ver>-linux-x64`.
- Rust: rustup minimal profile in `~/.cargo`.
- patchelf, which bundles `libatomic.so.1`: run `apt-get download patchelf` and
  `dpkg -x` it into `~/.cache/t3-sync-tools/patchelf/root`.
- Vite+: bootstrap the version pinned in `pnpm-workspace.yaml` with
  `npm exec --package=vite-plus@<ver> -- vp install --frozen-lockfile`, then use
  `node_modules/.bin/vp`.

Run the build detached (`setsid nohup … > build.log`) so an SSH drop cannot kill
it. This produced the validated linux-x64 archive:

```bash
(
set -euo pipefail
B="$HOME/.cache/t3-sync-build/t3code"; cd "$B"
export PATH="$HOME/.cache/t3-sync-node/node-v26.12.1-linux-x64/bin:$B/node_modules/.bin:$HOME/.cargo/bin:$HOME/.cache/t3-sync-tools/patchelf/root/usr/bin:/usr/local/bin:/usr/bin:/bin"
RELEASE_VERSION=$(cat "$SYNC_RUN/nightly-version.txt")
BUILD_NODE_VERSION=$(node -p "require('./package.json').engines.node")
test "$(node --version)" = "v$BUILD_NODE_VERSION"
test "$(git rev-parse HEAD)" = "$(cat "$SYNC_RUN/integrated.sha")"
MANIFESTS="apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json"
for m in $MANIFESTS; do git diff --quiet HEAD -- "$m"; done
VP_VERSION=$(sed -nE 's/^  vite-plus: ([0-9][^ ]*)$/\1/p' pnpm-workspace.yaml)
test -x node_modules/.bin/vp || npm exec --yes --package="vite-plus@$VP_VERSION" -- vp install --frozen-lockfile
trap 'git restore --worktree -- $MANIFESTS' EXIT
node scripts/update-release-package-versions.ts "$RELEASE_VERSION"
vp run --filter @t3tools/web build
vp run --filter t3 build
VP_NODE_VERSION="$BUILD_NODE_VERSION" node apps/server/scripts/cli.ts build-exe --verbose
cargo build --locked --release --target x86_64-unknown-linux-gnu \
  --manifest-path native/resource-monitor/Cargo.toml
mkdir -p "$SYNC_RUN/remote-resource-monitor/linux-x64"
cp native/resource-monitor/target/x86_64-unknown-linux-gnu/release/t3-resource-monitor \
  "$SYNC_RUN/remote-resource-monitor/linux-x64/t3-resource-monitor"
node scripts/build-cli-archive.ts --platform linux --arch x64 \
  --version "$RELEASE_VERSION" \
  --resource-monitor-dir "$SYNC_RUN/remote-resource-monitor" \
  --output-dir "$SYNC_RUN/remote-archive"
A="$SYNC_RUN/remote-archive/t3-${RELEASE_VERSION}-linux-x64.tar.gz"
node scripts/smoke-cli-archive.ts --archive "$A" --expect-version "$RELEASE_VERSION"
(cd "$SYNC_RUN/remote-archive" && sha256sum "$(basename "$A")") > "$SYNC_RUN/archive.sha256"
)
```

A changed `vite-plus` pin or lockfile means a fresh `vp install`: remove the
checkout's `node_modules` first, because the `test -x` guard skips the install.

## Activate without replacing it with an upstream binary

Prepare all three target artifacts before activation. Preserve the existing
service configuration and live V2 data. Stage the complete custom runtime,
verify its executable reports the frozen version, and back up the active runtime
before replacement. Use the existing service's installation layout deliberately;
do not blindly run the official installer or t3 update, which may substitute
an upstream binary with the same version.

For the existing `runtime/versions/<version>` layout, write both `.install-complete`
containing the exact Nightly version and `personal-source.sha` containing the
integrated SHA inside the completed runtime directory. Inspect the current
launcher and installer's cache behavior before activation. A version marker
alone does not prove custom source, and a source marker alone may permit the
installer to overwrite an apparently incomplete runtime.

Point the existing service/launcher to the completed runtime, restart only that
service, and keep a durable activation log. For a rebuild that keeps the same
Nightly version, `t3 service install` can report "already installed" and leave
the old process running even though its file was replaced. Explicitly run
`t3 service restart --base-dir <existing-base-dir>`. Record the pre-activation
server PID and start time; require a new process started after activation,
then verify the source marker, executable hash, environment identity, health,
and actual private-relay publication. Same version/path alone proves nothing
about which code the running process loaded. If the coordinator depends on this
server, activate from an independent shell. Kill only a process captured at
spawn or verified as owned by this deployment; never kill by pattern.

On R2-D2, `t3 service install` previously wrote the correct LaunchAgent but
activation returned `Bad request` after the old unit was booted out. If that
recurs, inspect the existing `com.t3tools.t3code.service` plist and its runtime
path, then bootstrap that same plist into `gui/$(id -u)` with `launchctl` and
verify `launchctl print`. Do not reinstall an upstream runtime or create a
second service as a workaround.

### C-3PO activation

C-3PO's T3 home is `~/.t3`, its launcher is `~/.local/bin/t3` (listed in
`~/.t3/runtime/launchers`), and the service is the systemd user unit
`t3code.service`, which runs `runtime/versions/<version>/t3 __service-launcher`.
The drop-in
`~/.config/systemd/user/t3code.service.d/login-shell.conf` sets
`SHELL=/usr/bin/zsh`. systemd otherwise hands the service bash, whose stock
Ubuntu login files never load the fleet PATH (bun → Codex, `~/.grok/bin`, nvm),
so Codex and Grok show as "Not found". Keep the drop-in across reinstalls.
Lingering is on for `jake`. Without it the service stops at logout, and turning
it back on needs Jake's sudo. Access matches R2-D2: T3 Connect
is on and signed in to Jake's T3 account (relay client: `~/.t3/tools/cloudflared`),
and LAN/tailnet access is on with pairing codes. The server listens on plain
HTTP on port 3773 at `c-3po.tail732053.ts.net`. There is no Tailscale Serve
HTTPS, so the desktop's bare-host _Remote link_ (which assumes `https://`) fails.
Jakebook's desktop finds C-3PO through T3 Connect.

1. Check the archive with `sha256sum -c archive.sha256`, unpack it in SYNC_RUN,
   and check that `t3 --version` prints `t3 v<frozen version>`.
2. Write `.install-complete` and `personal-source.sha` into the staged directory.
   Move any existing `runtime/versions/<version>` aside into SYNC_RUN, then move
   the staged runtime into place and repoint `~/.local/bin/t3` at it.
3. Record the server's PID and start time before restarting. Then run
   `~/.local/bin/t3 service install` followed by `~/.local/bin/t3 service
   restart`. Leave the routes as they are; do not re-run `t3 up` with
   different flags.
4. Verify: `systemctl --user show t3code.service -p ActiveState -p MainPID`
   shows a new process started after activation. The SHA-256 of
   `/proc/<pid>/exe` equals the staged `t3`. `personal-source.sha` equals
   integrated.sha. `curl http://c-3po.tail732053.ts.net:3773/` from Jakebook
   returns 200, and the linked C-3PO environment answers from Jakebook.

A first-time enrollment on a fresh home is steps 1–2, then `t3 up --lan`
instead of step 3. Over SSH with `--lan` alone it installs the service with
T3 Connect off. Then run `t3 up --connect --headless` detached with a log. It
prints an `accounts.t3.codes/device` URL and code. Jake approves it with the
same account as R2-D2, and the service restarts on the same runtime. After
that, C-3PO appears in Jakebook's desktop Environments.

Jakebook, R2-D2 and C-3PO are linked to each other in both directions with
full access. Labs → Linked environments must be on in each machine's own
settings, or that machine refuses links. To link one server to another from
the command line, mint a 5-minute code on the target with `t3 pair` and run
`t3 environment link <url> --url <relay url> --pairing-code <code> --access
full-access` on the source. Never print the code. Plain `http://` is accepted
only on the `*.ts.net` name (not the tailnet IP), and a new relay hostname
can stay NXDOMAIN for a while on a machine that looked it up too early. A
sync preserves all of these links; check them with `t3 environment list` on
each machine.

## Verify the running server

Check the configured executable, active process, service status, health endpoint
or server descriptor, full Nightly version, and personal-source.sha. CLI
--version alone only proves the selected file, not the running service. Confirm
the existing direct/relay connection and desktop access to each target. Preserve V2
history and check database integrity using read-only access.

Verify the iPhone's R2-D2 interaction when separately authorized. Keep process
launch, connection checks, and interactive protocol verification distinct in
the run receipt. A missing update banner is not version/source evidence.
