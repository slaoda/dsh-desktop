# Decision: Manage eligible existing installs and recoverable updates

Status: implemented
Category: architecture

## Problem

The original desktop boundary owns only application-managed Harness versions and deliberately does not read Harness user data. The Windows manager product requires in-place management of eligible existing installations and recoverable updates that back up configuration and sessions. Implementing either without an explicit ownership model could delete external files, expose credentials, or commit a broken version switch.

## Decision

Add two narrow, opt-in capabilities:

1. Detect external installations, validate the official package manifest and contained CLI, and classify them by origin. Project-local and ambiguous PATH entries remain read-only. Only a verified npm-global installation can be uninstalled, and uninstall delegates to the matching package manager instead of deleting directories.
2. Back up a user-confirmed Harness home through allowlisted categories while always excluding credentials. Keep at most three backups by default. Treat version switching as a journaled transaction and persist the candidate selection only after loopback health succeeds.

Downloaded packages never provide migration code. Known migrations are manager-owned, allowlisted operations; unknown breaking changes require an explicit warning.

## Verification

Focused tests cover external-install classification and CLI containment, credential and environment-file exclusion, diagnostic redaction, backup integrity, stale journals, and candidate rollback. `npm run verify` enforces IPC and source boundaries. `npm run test:official` launches the pinned package, and packaged E2E verifies exact-version removal, close-to-tray lifecycle, candidate-failure reporting, and rollback through the shipped Electron entry path.

## Alternatives considered

- Continue managing only application-owned versions. This is safer but does not meet the approved in-place-management requirement.
- Import external installations into application storage. This duplicates large packages and contradicts the requested in-place behavior.
- Let each downloaded version run its own migration scripts. This crosses the trust boundary and permits unreviewed code to modify user data.
- Back up the entire Harness home. This risks copying API keys and unrelated user files.

## Consequences

- Harness data layout may change, so backups intentionally remain partial and category-allowlisted rather than claiming the whole home.
- Global package-manager discovery differs across Windows environments; ambiguous PATH and project entries remain read-only.
- Recoverable switches use additional disk space for up to three credential-safe backups and retained exact versions.
- The manager gains narrowly scoped read/restore access to allowlisted user-owned data while external package directories remain outside its ownership.
