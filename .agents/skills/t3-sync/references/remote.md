# Rebuild and deploy R2-D2

Use the existing R2-D2 environment over its configured SSH/Tailscale route.
Confirm the host, installation owner, CLI path, service, actual T3 home, and
CPU/OS from configuration before changing anything. Test an actual SSH command;
Tailscale Online alone does not establish access. Record non-secret target
details in SYNC_RUN, preserving identity, credentials, home, and connection
configuration. Never enroll unrelated hosts or start a second server on its home.

If access is blocked, continue independent builds and report deployment as
incomplete. Resume only the blocked build/deployment/verification step after
reconnection; do not reset source or select a new Nightly.

## Build from the integrated source

Always rebuild the R2-D2 server from this run's integrated.sha, with the frozen
Nightly version. A published upstream runtime omits Jake's server changes.
Use an isolated checkout on R2-D2 or a matching OS/CPU builder. Transfer the exact
source commit, lockfile, and necessary public T3 Connect configuration privately.
Do not build against the live T3 home.

Follow that source's normal standalone release pipeline. Inspect
scripts/build-cli-archive.ts and .github/workflows/release.yml for build
prerequisites and the current CLI archive steps: server executable, bundled web
client, resource monitor, and native runtime dependencies. Stamp the frozen
Nightly version and restore tracked release manifests afterward. Record the
archive path, checksum, platform/architecture, version, and integrated Git SHA.
The runtime and bundled web client must come from that same source.

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
service, and keep a durable activation log. If the coordinator depends on this
server, activate from an independent shell. Kill only a process captured at
spawn or verified as owned by this deployment; never kill by pattern.

## Verify the running server

Check the configured executable, active process, service status, health endpoint
or server descriptor, full Nightly version, and personal-source.sha. CLI
--version alone only proves the selected file, not the running service. Confirm
the existing direct/relay connection and desktop access to R2-D2. Preserve V2
history and check database integrity using read-only access.

Verify the iPhone's R2-D2 interaction when separately authorized. Keep process
launch, connection checks, and interactive protocol verification distinct in
the run receipt. A missing update banner is not version/source evidence.
