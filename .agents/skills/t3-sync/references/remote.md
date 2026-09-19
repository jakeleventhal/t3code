# Remote preview update

Use the existing remote environment over its configured SSH/Tailscale route.
Discover the host, installation owner, CLI path, service, actual T3 home, and
CPU/OS before changing anything. `r2d2` has been used previously, but confirm the
current environment from configuration; do not infer reachability from Tailscale
`Online`. Test an actual SSH command. Do not enroll unrelated hosts.

Record non-secret target details in the private run directory. Preserve the
existing environment identity, credentials, home, and connection configuration.
If access is blocked, continue independent builds and report remote deployment
as incomplete. Do not repeatedly reset source or rebuild after connectivity returns.

## Choose the remote artifact deliberately

The existing arrangement uses the published upstream server on the remote. Keep
that arrangement only when the custom client changes work with the upstream
preview's wire contract and server behavior. The official remote does not contain
Jake's server-side PRs or integration fixes. Audit this explicitly for each run.

If required remote behavior depends on custom server changes, build the server
from the same `integrated.sha` on a matching OS/CPU in an isolated checkout using
that source's release pipeline. Stamp the selected preview version and record
the custom SHA as well. Install the resulting standalone runtime through the
existing service configuration without allowing it to download and substitute
the upstream artifact. Inspect `scripts/build-cli-archive.ts` and the selected
release workflow for current build prerequisites. A matching version string
alone does not establish that a custom server was deployed.

## Published standalone runtime

Use the exact `version` from `release.json`, never a new latest lookup. Verify the
snapshot contains `t3-<version>-<platform>-<arch>.tar.gz` and `SHA256SUMS`.
Transfer the installer from the already-frozen source commit, not moving `main`.
It verifies the release archive checksum. Inspect it before execution if changed.

For an existing standalone preview installation, invoke its CLI with
`t3 update <exact-version> --yes` using the correct home. Then inspect service
status and the running endpoint. On the remote, with the verified absolute home/bin paths and pinned installer:

```bash
T3CODE_VERSION="$RELEASE_VERSION" T3CODE_CHANNEL=preview \
  T3CODE_HOME="$REMOTE_T3_HOME" T3CODE_INSTALL_BIN_DIR="$REMOTE_BIN_DIR" \
  sh "$PINNED_INSTALLER"
"$REMOTE_BIN_DIR/t3" --version
"$REMOTE_BIN_DIR/t3" service install --base-dir "$REMOTE_T3_HOME"
"$REMOTE_BIN_DIR/t3" service restart --base-dir "$REMOTE_T3_HOME"
"$REMOTE_BIN_DIR/t3" service status --base-dir "$REMOTE_T3_HOME"
```

Do not run this blindly against npm/package-managed or custom service installs.
Inspect their ownership first and migrate the existing service deliberately.
Never start a second server on the same home. Preview semver can compare below
a later V1 Nightly; use `--allow-downgrade` only when the recorded target is the
intentional selected V2 release and the CLI requires it. Do not change the release
selection to satisfy version ordering. Subsequent runs remain V2 only.

## Verify the running server

CLI `--version` only proves the selected executable. Inspect the service's
configured executable, active process and health endpoint/server descriptor, and
compare its advertised version with the exact selected preview. Check the
existing direct or relay connection too. Do not expose pairing tokens in logs.

The preview's version-skew UI may compare only core semver, hiding differences
between preview builds. A missing update banner is not success. After activation,
verify the custom desktop can reach this remote; verify the iPhone connection
when interaction is authorized. Persist results in the run receipt.
