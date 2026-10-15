# Personal background delivery

Jake's Apple team is `BNKA7GN2H2`; personal app and widget builds use sandbox
APNs. Signing into Xcode supplies provisioning, not a relay APNs private key.
The public relay's widget endpoint returned 404 during the October 6 repair.
Do not assume its Apple signing identity can send to Jake's bundle IDs.

## Preserve the separate delivery service

Background delivery uses `https://r2-d2.tail732053.ts.net:8449`. Keep the ordinary
T3 Connect relay `https://relay.t3.codes` and existing Clerk configuration for
chat, environment discovery, and remote connections. Only mobile awareness
registration/snapshots and server activity publication use the private service.
The iPhone needs Tailscale connected for widget fetches. R2-D2 must be awake and
online; APNs still delivers notifications through Apple.

On R2-D2, the deployment consists of:

- `~/.local/share/t3-personal-relay/runtime/`: bundled Node entrypoint.
- `~/.local/share/t3-personal-relay/postgres/`: separate PostgreSQL 18 database,
  loopback port 55439, database `t3_personal_relay`.
- `~/.local/share/t3-personal-relay/queue/`: persistent signed APNs jobs.
- `~/.config/t3-personal-relay/settings.json`: private relay settings and keys.
- LaunchAgents `com.jakeleventhal.t3-personal-postgres` and
  `com.jakeleventhal.t3-personal-background`; Node 24.19.0, HTTP loopback 9849.
- Tailscale Serve port 8449 forwarding to 9849. Preserve all other Serve routes.

The APNs key ID is `5HHHNKLTWH`, sandbox/topic-specific for the personal app and
widget. Its `.p8` is stored with mode 600 under `~/.config/t3-personal-relay/` on
Jakebook and R2-D2 (directory 700). Never print, commit, regenerate, or revoke
existing credentials during a sync. Use private files/secret stores for transfers.
The relay pins the existing Clerk JWT issuer and Jake's account using the public
JWT verification key; it does not need a public-service Clerk secret. Verify the
stored public key still matches `https://clerk.t3.codes/.well-known/jwks.json`
before deployment; refresh that public key if Clerk rotates it. Never change the
pinned account or issuer to work around authentication failures.

Each installed server reads `~/.config/t3-personal-relay/publisher.json`, with
`url` and its separate `environmentCredential`. This opts it into private
activity publication even if public T3 Connect activity sharing is off. Preserve
that file and the corresponding personal database link/credential rows. Keep
the existing T3 environment identity and signing key; do not edit live userdata
or replace public T3 Connect credentials. A new environment needs an explicit
personal link and separately generated credential in this private database.

## Update and validate

Build the relay from the same integrated source with `vp pack` in `infra/relay`.
Stage all files from `dist-personal/` in a new runtime directory on R2-D2. Preserve
the old runtime for rollback. Apply missing SQL migrations from
`infra/relay/migrations/postgres/*/migration.sql` in sorted order, each in its own
transaction, recording successful directory names in `personal_migrations`.
Back up this private database first; never run migrations against public/shared
production. Restart only the personal background LaunchAgent after staging,
then verify `/health` returns 200 and the widget route rejects an invalid bearer
with 401. Record source SHA, checksums, service state, and the private origin in
SYNC_RUN. An unauthenticated route response alone is not delivery proof.

Build the iPhone with `T3CODE_PERSONAL_BACKGROUND_RELAY_URL` set to the private
origin on config, prebuild, and xcodebuild. Assert the resolved Expo extra has
that origin **and** the normal relay remains `https://relay.t3.codes`. Verify
sandbox entitlements and both signed profiles using `verify-iphone.py`.

After installing and foregrounding the app once, confirm its registration in
the personal relay has app and widget tokens without printing them, and an
activity-update token after the app arms a Live Activity. The current app starts
Live Activities in the foreground; an absent push-to-start token is expected.
Verify a real server state transition reaches the private database. With
the app backgrounded, verify a completion notification, Live Activity update,
and widget refresh. Correlate APNs results and database timestamps with physical
phone evidence. HTTP 200 from APNs proves acceptance, not visible delivery.
If the physical phone is unavailable to automation, ask Jake to confirm these
observations; retain the unverified status until then. Restore any temporary test
state and remove only the test's own activity rows after validation.
