# Return to the normal source workflow after V2 lands on main

This note removes the temporary preview-release selection. It never switches
back to V1 or replaces an existing V2 database.

When Jake requests the switch, verify that current upstream `main` AND the
published Nightly used by remote servers contain the required V2 implementation.
Then update the canonical skill commit and keep the same trigger:

- Reset `personal` to the fetched `upstream/main` SHA for each run.
- Resolve the newest published Nightly tag reachable from that SHA, verify its
  required release assets, and freeze its version for that run.
- Place the one workflow-only `personal-sync` commit directly above that main SHA.
- Rebase the two named fork features onto `upstream/main` instead of the temporary
  orchestrator branch, then include their patches alongside open authored PRs.
- Preserve the frozen open authored PR snapshot and durable fork changes. Reconcile any
  V2 ports that upstream now includes instead of maintaining duplicate fixes.
- Stamp the Nightly version and use `T3 Code (Nightly).app` in packaging/install
  commands. Keep `app-update.yml` absent so official binaries cannot replace the
  custom desktop build.
- Restore normal remote Nightly updating after checking full-version skew and
  update support. Verify the running remote version even when using the UI offer.
- Keep building the iPhone from the integrated source and keep all V2 databases.

The historical full workflow remains available with
`git show 8163fe96060d2e38f51652d30457f7faae99a83e:SYNC.md`.
It is a reference for source selection and packaging, not a script to run blindly
against newer code. Remove obsolete preview instructions when making the switch.
